import { readFileSync } from 'fs';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OffFormulaNotice } from '../OffFormulaNotice';
import type { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports '/favicon.ico?url' —
// unresolvable under Vitest. Same workaround as the other component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
// `basisDerivation.ts` (real, unmocked) imports `normalise` from this module, so only
// `detectOffFormulaStats` is overridden — same pattern `OffFormulaTuningPanel.test.tsx` uses,
// rather than a hand-copied `normalise` that can drift from the real one.
vi.mock('../../../utils/autogear/simRerank/offFormulaStats', async () => {
    const actual = await vi.importActual<
        typeof import('../../../utils/autogear/simRerank/offFormulaStats')
    >('../../../utils/autogear/simRerank/offFormulaStats');
    return { ...actual, detectOffFormulaStats: vi.fn() };
});
import { detectOffFormulaStats } from '../../../utils/autogear/simRerank/offFormulaStats';

const ship = { id: 's', name: 'Chakara', type: 'ATTACKER' } as unknown as Ship;
const mocked = vi.mocked(detectOffFormulaStats);

describe('OffFormulaNotice', () => {
    it('names the stat and the role formula that ignores it', () => {
        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        // Pins the whole sentence, not just the word "defence" — a subject-verb mismatch like
        // "damage scale off" (plural verb, singular subject) would slip past a bare word match.
        expect(screen.getByText(/damage scales off Defence/)).toBeInTheDocument();
        expect(screen.getByText(/Attacker/)).toBeInTheDocument();
    });

    it('renders nothing at all when the ship has no finding', () => {
        mocked.mockReturnValue([]);
        const { container } = render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        // An empty wrapper div would still push layout and read as a bug in a dense settings
        // panel, so assert on the container rather than on absence of text.
        expect(container).toBeEmptyDOMElement();
    });

    // A shared word ("trade" appearing in both copies, say) would let this pass regardless of
    // which severity actually renders, so each assertion below checks the OTHER severity's
    // phrase is absent, not just that its own phrase is present.
    it('reads a substitution finding differently from a severe one', () => {
        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'substitution',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        const { unmount } = render(<OffFormulaNotice ship={ship} configuredRole="DEFENDER" />);
        expect(screen.getByText(/trade/i)).toBeInTheDocument();
        expect(screen.queryByText(/does not score/i)).not.toBeInTheDocument();
        unmount();

        mocked.mockReturnValue([
            {
                stat: 'defence',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'defence',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="DEFENDER" />);
        expect(screen.getByText(/does not score/i)).toBeInTheDocument();
        expect(screen.queryByText(/trade/i)).not.toBeInTheDocument();
    });

    // The collapse, from the notice's side: the sentence must name BOTH what the damage reads
    // and the gearable stat behind it, or a player told to tune HP has no idea why.
    it('names the chain when the lever is not what the effect reads', () => {
        mocked.mockReturnValue([
            {
                stat: 'shield',
                produces: 'damage',
                severity: 'severe',
                trigger: 'on-cast',
                tunableStat: 'hp',
            },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        expect(
            screen.getByText(/damage scales off its shield pool, which HP drives/)
        ).toBeInTheDocument();
        // Severity names the LEVER, not a bare "it": the reader has just been shown two stats.
        expect(screen.getByText(/does not score HP/)).toBeInTheDocument();
    });

    // The gate. Non-vacuity for the case above: the same finding WITHOUT a lever must offer no
    // equation line, or it would claim a gearing story for a stat nothing can move.
    it('offers no equation line for a finding with no gearable lever, but still reports it', () => {
        mocked.mockReturnValue([
            { stat: 'shield', produces: 'damage', severity: 'severe', trigger: 'on-cast' },
        ]);
        render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
        expect(screen.getByText(/damage scales off its shield pool/)).toBeInTheDocument();
        expect(screen.getByText(/nothing to measure/i)).toBeInTheDocument();
    });
});

// --- Real-corpus fixtures, mirroring basisDerivation.test.ts and offFormulaStats.test.ts's own
// corpus loaders exactly (each of those files carries the same copy independently). Gitignored
// reference data (docs/ship-skills.csv, docs/ship-data.json) exists on dev machines but not every
// checkout — skip rather than fail where it's absent.

interface Datum {
    name: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    hacking: number;
    security: number;
    speed: number;
    critRate: number;
    critDamage: number;
}

// 4 refits so the highest-unlocked passive resolves (skillRows.ts gates R4 at 4, R2 at 2) —
// players tune maxed ships, and detecting against the R0 passive reads the wrong clause.
const asShip = (rec: ReturnType<typeof loadShipSkillRecords>[number], d: Datum): Ship =>
    ({
        id: rec.name.toLowerCase(),
        name: rec.name,
        type: d.role,
        baseStats: {
            attack: d.attack,
            crit: d.critRate,
            critDamage: d.critDamage,
            hacking: d.hacking,
            security: d.security,
            defence: d.defense,
            hp: d.hp,
            speed: d.speed,
        },
        equipment: {},
        implants: {},
        refits: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, stats: [] })),
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        chargedTarget: 'front',
        chargedPattern: 'Pattern-Base',
    }) as unknown as Ship;

const corpusShipNamed = (name: string): Ship => {
    const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
    const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
    const rec = loadShipSkillRecords().find((r) => r.name.toLowerCase() === name.toLowerCase());
    const d = byName.get(name.toLowerCase());
    if (!rec || !d) throw new Error(`mutation guard: no corpus ship named ${name}`);
    return asShip(rec, d);
};

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'OffFormulaNotice over the real corpus',
    () => {
        let realDetect: typeof detectOffFormulaStats;

        beforeAll(async () => {
            const actual = await vi.importActual<
                typeof import('../../../utils/autogear/simRerank/offFormulaStats')
            >('../../../utils/autogear/simRerank/offFormulaStats');
            realDetect = actual.detectOffFormulaStats;
        });

        it('states the derived equation in the ship own numbers', () => {
            mocked.mockImplementation(realDetect);
            const prophet = corpusShipNamed('Prophet');
            render(<OffFormulaNotice ship={prophet} configuredRole="ATTACKER" />);
            // Prophet's damage multiplier is 0 — his real output is Security x57.778 and reads
            // NOTHING off Attack, which the ATTACKER formula assumes is the whole story.
            expect(screen.getByText(/Security x57\.778/)).toBeInTheDocument();
            expect(screen.getByText(/nothing from Attack/i)).toBeInTheDocument();
        });

        it('names the excluded carrier verbatim rather than a general caveat', () => {
            mocked.mockImplementation(realDetect);
            const rikra = corpusShipNamed('Rikra');
            render(<OffFormulaNotice ship={rikra} configuredRole="ATTACKER" />);
            // Rikra's whole carrier lives in a passive slot, so the derived basis matches
            // today's behaviour exactly — the excluded-clause sentence is the only useful
            // content, and it must name the specific clause, not a generic caveat.
            expect(
                screen.getByText(/repairs 60% of max HP when an enemy is destroyed/i)
            ).toBeInTheDocument();
            expect(
                screen.getByText(/a passive's frequency depends on the fight/i)
            ).toBeInTheDocument();
        });

        it('shows the notice for a substitution finding, not only a severe one', () => {
            mocked.mockImplementation(realDetect);
            const panon = corpusShipNamed('Panon');
            // Narrowing to `severe` would silence Panon and Vindicator, both owner-named known
            // positives (their finding survives only because effectiveHp's components are never
            // expanded when deciding whether the formula covers a stat). Both severities keep
            // their notice — all 47 flagged ships.
            render(<OffFormulaNotice ship={panon} configuredRole="DEFENDER" />);
            expect(screen.getByText(/Panon/)).toBeInTheDocument();
        });

        // `excludedCarriers` reports a `damage`-produces carrier too (a `shieldBasisPct` clause
        // here), not only the `repair` shape Rikra covers above — its own clause reads "deals
        // damage equal to", never the bare noun `PRODUCES_LABEL.damage.scales` starts with.
        it('names a damage-produces excluded carrier with its own clause, not the aggregate verb', () => {
            mocked.mockImplementation(realDetect);
            const xcellence = corpusShipNamed('Xcellence');
            render(<OffFormulaNotice ship={xcellence} configuredRole="ATTACKER" />);
            expect(
                screen.getByText(
                    /Xcellence deals damage equal to 115% of its shield pool when an enemy resists a debuff/i
                )
            ).toBeInTheDocument();
        });

        // Howler's repair is 100% Attack — no OTHER stat feeds it, but also no passive clause
        // exists to blame, unlike Rikra/APEX above. The copy must not claim there is one.
        it('states the scoring is unchanged with no passive clause to point at', () => {
            mocked.mockImplementation(realDetect);
            const howler = corpusShipNamed('Howler');
            render(<OffFormulaNotice ship={howler} configuredRole="SUPPORTER" />);
            expect(
                screen.getByText(/No stat besides Attack feeds its active or charged basis/i)
            ).toBeInTheDocument();
            expect(screen.queryByText(/passive keeps the optimizer/i)).not.toBeInTheDocument();
        });
    }
);
