import { readFileSync } from 'fs';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OffFormulaNotice, type OffFormulaApplyUpdate } from '../OffFormulaNotice';
import type { Ship } from '../../../types/ship';
import type { CustomFormulaRow } from '../../../types/autogear';
import { CUSTOM_FORMULA_SEEDS } from '../../../utils/autogear/customFormulaSeeds';
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
        expect(screen.getByText(/nothing to put in a formula/i)).toBeInTheDocument();
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

const closeTo = (n: number, precision = 3) => expect.closeTo(n, precision);

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
            // Rikra's exclusion trigger is `on-enemy-destroyed`, a reactive trigger, so the
            // frequency-uncertainty reason is the right one for him (contrast the known-cadence
            // ships below).
            expect(
                screen.getByText(/a passive's frequency depends on the fight/i)
            ).toBeInTheDocument();
            // Rikra's lever IS HP, so `equationLine` does run for him — but his repair basis has
            // no active/charged term at all (the only repair carrier is the passive one just
            // asserted above), so the "unchanged" branch fires and appends this pointer sentence.
            // This is the only test in the file asserting the pointer's PRESENCE; every other
            // test that touches it (Howler, below) asserts its absence instead.
            expect(
                screen.getByText(
                    /The clause below is what a passive keeps the optimizer from counting/i
                )
            ).toBeInTheDocument();
        });

        // FrontLine's exclusion trigger is `pre-combat`: guaranteed, exactly once, every fight —
        // its frequency is not in question, so blaming "frequency depends on the fight" would be
        // self-contradicting next to a sentence that just said "at the start of the fight".
        it.each(['Crucialis', 'FrontLine', 'IonScorp'])(
            "%s's pre-combat exclusion does not blame fight-dependent frequency",
            (name) => {
                mocked.mockImplementation(realDetect);
                const ship = corpusShipNamed(name);
                render(<OffFormulaNotice ship={ship} configuredRole="ATTACKER" />);
                expect(
                    screen.queryByText(/a passive's frequency depends on the fight/i)
                ).not.toBeInTheDocument();
                expect(
                    screen.getByText(
                        /doesn't fit the active-versus-charged cast ratio the basis is built from/i
                    )
                ).toBeInTheDocument();
            }
        );

        it('shows the notice for a substitution finding, not only a severe one', () => {
            mocked.mockImplementation(realDetect);
            const panon = corpusShipNamed('Panon');
            // Narrowing to `severe` would silence Panon and Vindicator, both owner-named known
            // positives (their finding survives only because effectiveHp's components are never
            // expanded when deciding whether the formula covers a stat). Both severities keep
            // their notice — all 47 flagged ships. Panon's own tunable stat collapses onto what
            // the effect reads (both are Defence), so the sentence reads "scores it", not a named
            // stat — pinning the substitution phrasing itself, not just that his name rendered.
            render(<OffFormulaNotice ship={panon} configuredRole="DEFENDER" />);
            expect(
                screen.getByText(
                    /The Defender formula scores it only as part of a total it can trade away for another stat/
                )
            ).toBeInTheDocument();
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

        // Xcellence carries TWO excluded clauses (the shieldBasisPct damage clause above, plus an
        // hp-to-shield clause), the only one of the ten passive-only ships with more than one —
        // the pointer sentence must agree in number rather than read "the clause below" over two.
        it("uses the plural pointer for Xcellence's two excluded clauses", () => {
            mocked.mockImplementation(realDetect);
            const xcellence = corpusShipNamed('Xcellence');
            render(<OffFormulaNotice ship={xcellence} configuredRole="ATTACKER" />);
            expect(
                screen.getByText(
                    /The clauses below are what a passive keeps the optimizer from counting/i
                )
            ).toBeInTheDocument();
            expect(
                screen.queryByText(
                    /The clause below is what a passive keeps the optimizer from counting/i
                )
            ).not.toBeInTheDocument();
        });

        // Howler's repair is 100% Attack, and the SUPPORTER formula's core row scores HP — the
        // basis is Attack-only, which does NOT match the role's own baseline, so this is a real
        // change worth reporting, not the "unchanged" sentence (see `roleCoreStat`).
        it("states what Attack displaces from the SUPPORTER formula's HP baseline", () => {
            mocked.mockImplementation(realDetect);
            const howler = corpusShipNamed('Howler');
            render(<OffFormulaNotice ship={howler} configuredRole="SUPPORTER" />);
            expect(
                screen.getByText(/In its own numbers, this is Attack x1\.067, and nothing from HP/i)
            ).toBeInTheDocument();
            expect(
                screen.queryByText(/No stat besides Attack feeds its active or charged basis/i)
            ).not.toBeInTheDocument();
        });

        // Graphite's shield is also 100% Attack under the same SUPPORTER core-on-HP baseline —
        // a second ship pinning the same corrected sentence shape, not just Howler's numbers.
        it("states the same displacement for Graphite's shield basis", () => {
            mocked.mockImplementation(realDetect);
            const graphite = corpusShipNamed('Graphite');
            render(<OffFormulaNotice ship={graphite} configuredRole="SUPPORTER" />);
            expect(
                screen.getByText(/In its own numbers, this is Attack x1\.350, and nothing from HP/i)
            ).toBeInTheDocument();
        });

        // The control case: APEX's real in-game role is DEBUFFER, but configured here as
        // ATTACKER — a role whose own core row (directDamage) already scores Attack — and his
        // derived damage basis is Attack-only, so the "unchanged" sentence is correct, unlike for
        // Howler/Graphite above (SUPPORTER, whose core row scores HP instead).
        it('still states the scoring is unchanged for an Attack-scored role with an Attack-only basis', () => {
            mocked.mockImplementation(realDetect);
            const apex = corpusShipNamed('APEX');
            render(<OffFormulaNotice ship={apex} configuredRole="ATTACKER" />);
            expect(
                screen.getByText(/No stat besides Attack feeds its active or charged basis/i)
            ).toBeInTheDocument();
        });

        describe('Apply', () => {
            it('applies a formula seeded from the role, with the basis on its core row', () => {
                mocked.mockImplementation(realDetect);
                const cobalt = corpusShipNamed('Cobalt');
                const onApply = vi.fn();
                render(
                    <OffFormulaNotice ship={cobalt} configuredRole="ATTACKER" onApply={onApply} />
                );
                fireEvent.click(screen.getByRole('button', { name: /use this/i }));
                expect(onApply).toHaveBeenCalledWith({
                    shipRole: null,
                    customFormula: {
                        seededFrom: 'ATTACKER',
                        rows: [
                            expect.objectContaining({
                                stat: 'directDamage',
                                kind: 'core',
                                basis: [
                                    { stat: 'attack', weight: closeTo(2.1) },
                                    { stat: 'hp', weight: closeTo(0.267) },
                                ],
                            }),
                        ],
                    },
                });
            });

            it('keeps naming the excluded carrier after the notice has gone', () => {
                mocked.mockImplementation(realDetect);
                const rikra = corpusShipNamed('Rikra');
                const onApply = vi.fn();
                // DEFENDER, not ATTACKER: Rikra's finding is a `repair` basis, which only has a
                // host on a survival/repair-proxy row (`effectiveHp`/`hp`) — ATTACKER's only
                // core row is `directDamage`, a damage proxy, so Apply is correctly withheld
                // there (see the axis-pairing describe block below).
                render(
                    <OffFormulaNotice ship={rikra} configuredRole="DEFENDER" onApply={onApply} />
                );
                fireEvent.click(screen.getByRole('button', { name: /use this/i }));
                const update = onApply.mock.calls[0][0] as OffFormulaApplyUpdate;
                const row = update.customFormula.rows[0];
                expect(row.excludedNote).toContain(
                    'repairs 60% of max HP when an enemy is destroyed'
                );
            });

            // SUPPORTER's seed has no `directDamage` row at all — attaching Makoli's repair
            // basis to "the first core row" rather than the row `roleCoreStat` actually names
            // (`hp`) would either attach it to the wrong row or throw. Makoli's own repair basis
            // is Defence-dominant (~19:1 over HP), so this also pins that the basis on the `hp`
            // row keeps its real ratio rather than collapsing to a single term.
            it('lands the basis on the hp core row, not a directDamage row SUPPORTER has none of', () => {
                mocked.mockImplementation(realDetect);
                const makoli = corpusShipNamed('Makoli');
                const onApply = vi.fn();
                render(
                    <OffFormulaNotice ship={makoli} configuredRole="SUPPORTER" onApply={onApply} />
                );
                fireEvent.click(screen.getByRole('button', { name: /use this/i }));
                const update = onApply.mock.calls[0][0] as OffFormulaApplyUpdate;
                const rows = update.customFormula.rows;

                expect(rows.some((r: CustomFormulaRow) => r.stat === 'directDamage')).toBe(false);
                const hpRow = rows.find((r: CustomFormulaRow) => r.stat === 'hp');
                expect(hpRow?.basis).toBeDefined();

                const hpWeight = hpRow!.basis!.find((t) => t.stat === 'hp')!.weight;
                const defWeight = hpRow!.basis!.find((t) => t.stat === 'defence')!.weight;
                expect(defWeight / hpWeight).toBeCloseTo(18.72, 1);
            });
        });

        // A formula core row has an AXIS, not merely a stat a basis can syntactically sit on:
        // `directDamage`/a plain `attack` row is a damage proxy, `effectiveHp`/a plain `hp` row
        // is a survival/repair proxy, and `security`/`hacking`/`speed` are not output proxies at
        // all. The row Apply targets must match the basis's OWN `produces` axis — a damage
        // basis never lands on a survival-proxy row and vice versa. `ROW_AXIS`/`PRODUCES_AXIS`
        // mirror `OffFormulaNotice`'s own (module-private) tables, the same way
        // `sharedAutogearBuild.test.ts` mirrors that schema's private caps.
        const ROW_AXIS: Record<string, 'damage' | 'survival'> = {
            directDamage: 'damage',
            attack: 'damage',
            effectiveHp: 'survival',
            hp: 'survival',
        };
        const PRODUCES_AXIS: Record<'damage' | 'repair' | 'shield', 'damage' | 'survival'> = {
            damage: 'damage',
            repair: 'survival',
            shield: 'survival',
        };

        const fullCorpus = (): Ship[] => {
            const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
            const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
            return loadShipSkillRecords()
                .map((rec) => {
                    const d = byName.get(rec.name.toLowerCase());
                    return d ? asShip(rec, d) : null;
                })
                .filter((s): s is Ship => s !== null);
        };

        // The specific reproduction from the review: Panon's own default role is DEFENDER,
        // whose only core row is `effectiveHp` (survival proxy). His finding is a `damage`
        // basis (Attack x2.275 + Defence x1.775) — there is no damage-proxy row on DEFENDER to
        // host it, so Apply must be withheld rather than write it onto `effectiveHp` anyway.
        it("withholds Apply for Panon's damage basis under DEFENDER, his own default role", () => {
            mocked.mockImplementation(realDetect);
            const panon = corpusShipNamed('Panon');
            const onApply = vi.fn();
            render(<OffFormulaNotice ship={panon} configuredRole="DEFENDER" onApply={onApply} />);
            expect(screen.queryByRole('button', { name: /use this/i })).not.toBeInTheDocument();
        });

        // The general invariant, over the real flagged corpus (real `detectOffFormulaStats`,
        // not a hand-written finding) x every role: whenever Apply is offered, the row it wrote
        // to sits on the SAME axis as the basis's own `produces` — never merely a row that could
        // syntactically hold some basis. Apply being absent is always an acceptable outcome; a
        // present button writing the wrong axis is not.
        describe('Apply — every real flagged (ship, role) pairing hosts a matching-axis basis, or is not offered', () => {
            it('never writes a basis onto a row whose axis disagrees with its own produces', () => {
                mocked.mockImplementation(realDetect);
                const roles = Object.keys(CUSTOM_FORMULA_SEEDS);
                let shown = 0;
                let withheld = 0;

                for (const ship of fullCorpus()) {
                    for (const role of roles) {
                        const findings = realDetect(ship, role);
                        if (findings.length === 0) continue;

                        const expectedAxis = PRODUCES_AXIS[findings[0].produces];
                        const seedHasHost = CUSTOM_FORMULA_SEEDS[role].rows.some(
                            (row) => row.kind === 'core' && ROW_AXIS[row.stat] === expectedAxis
                        );

                        const onApply = vi.fn();
                        const { unmount } = render(
                            <OffFormulaNotice ship={ship} configuredRole={role} onApply={onApply} />
                        );
                        const button = screen.queryByRole('button', { name: /use this/i });

                        if (!seedHasHost) {
                            expect(
                                button,
                                `${ship.name}/${role}: no ${expectedAxis}-axis row exists, Apply must be absent`
                            ).not.toBeInTheDocument();
                            withheld++;
                            unmount();
                            continue;
                        }

                        if (!button) {
                            // A matching-axis row exists but Apply is still absent for an
                            // unrelated reason (`hasSomethingToApply` — no basis term and no
                            // excluded carrier). Not this invariant's concern.
                            withheld++;
                            unmount();
                            continue;
                        }

                        fireEvent.click(button);
                        const update = onApply.mock.calls[0][0] as OffFormulaApplyUpdate;
                        const appliedRow = update.customFormula.rows.find(
                            (r: CustomFormulaRow) => r.basis !== undefined
                        );
                        expect(
                            appliedRow,
                            `${ship.name}/${role}: Apply wrote no row`
                        ).toBeDefined();
                        expect(
                            ROW_AXIS[appliedRow!.stat],
                            `${ship.name}/${role}: applied to ${appliedRow!.stat}, expected the ${expectedAxis} axis`
                        ).toBe(expectedAxis);
                        shown++;
                        unmount();
                    }
                }

                // Non-vacuity: the sweep must actually exercise both outcomes, or a detector
                // regression that always returns [] (Apply forever absent) or always finds a
                // host (Apply forever shown) would pass this test for the wrong reason.
                expect(shown).toBeGreaterThan(0);
                expect(withheld).toBeGreaterThan(0);
                // Renders the whole real corpus (150+ ships) x every role — comfortably under
                // 5s alone, but the default per-test timeout is tight under full-suite load
                // (matches roleSlotCoverage.test.ts's precedent for this shape of test).
            }, 20000);
        });
    }
);
