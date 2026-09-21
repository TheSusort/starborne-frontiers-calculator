import { readFileSync } from 'fs';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OffFormulaNotice, type OffFormulaApplyUpdate } from '../OffFormulaNotice';
import type { Ship } from '../../../types/ship';
import { deriveBasis } from '../../../utils/autogear/simRerank/basisDerivation';
import { roleAxis, roleHostsBasis } from '../../../utils/autogear/simRerank/roleBasisHost';
import { SHIP_TYPES } from '../../../constants/shipTypes';
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
            // Rikra's finding is `repair`-produces, and ATTACKER hosts `damage` — no equation
            // line, and no pointer to one, attaches to a finding on an axis the role doesn't
            // host (see the Zenith test below for the pointer's PRESENCE, on a finding the role
            // genuinely hosts).
            expect(
                screen.queryByText(
                    /The clause below is what a passive keeps the optimizer from counting/i
                )
            ).not.toBeInTheDocument();
        });

        // The pointer's counterpart to Rikra above: Zenith's `shield` finding IS what
        // SUPPORTER_SHIELD hosts, and its whole shield carrier lives in a passive slot (no
        // active/charged term at all), so `equationLine`'s "unchanged" branch legitimately fires
        // and appends this pointer sentence.
        it("points at Zenith's excluded shield clause when the finding is the axis SUPPORTER_SHIELD hosts", () => {
            mocked.mockImplementation(realDetect);
            const zenith = corpusShipNamed('Zenith');
            render(<OffFormulaNotice ship={zenith} configuredRole="SUPPORTER_SHIELD" />);
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

        // Graphite's shield finding is what SUPPORTER_SHIELD hosts (not SUPPORTER, which hosts
        // `repair`), and its shield is 100% Attack under that role's own HP-core baseline — a
        // second ship pinning the same corrected sentence shape, not just Howler's numbers.
        it("states the same displacement for Graphite's shield basis", () => {
            mocked.mockImplementation(realDetect);
            const graphite = corpusShipNamed('Graphite');
            render(<OffFormulaNotice ship={graphite} configuredRole="SUPPORTER_SHIELD" />);
            expect(
                screen.getByText(/In its own numbers, this is Attack x1\.350, and nothing from HP/i)
            ).toBeInTheDocument();
        });

        // The control case: Vindicator's `damage` finding is what ATTACKER hosts, and his
        // derived damage basis is Attack-only — matching ATTACKER's own core row exactly, so the
        // "unchanged" sentence is correct, unlike for Howler/Graphite above (whose hosting role's
        // core row scores HP instead).
        it('still states the scoring is unchanged for an Attack-scored role with an Attack-only basis', () => {
            mocked.mockImplementation(realDetect);
            const vindicator = corpusShipNamed('Vindicator');
            render(<OffFormulaNotice ship={vindicator} configuredRole="ATTACKER" />);
            expect(
                screen.getByText(/No stat besides Attack feeds its active or charged basis/i)
            ).toBeInTheDocument();
        });

        // The routing bug this task exists to close, on the DISPLAY path: `coreStat` is a
        // role-level constant, non-null whenever the role hosts anything, but a per-finding
        // equation line must gate on THIS finding's own `produces` matching the axis the role
        // hosts — never merely on `coreStat` being truthy. Cinya carries both a `damage` finding
        // and a `repair` finding; under ATTACKER (a damage-hosting role), the repair finding's
        // basis has no active/charged term, so unguarded code prints a false "unchanged" claim
        // computed against Attack, a stat the repair finding has nothing to do with.
        it("attaches no equation line to a finding on an axis the role doesn't host", () => {
            mocked.mockImplementation(realDetect);
            const cinya = corpusShipNamed('Cinya');
            render(<OffFormulaNotice ship={cinya} configuredRole="ATTACKER" />);
            // The repair finding's own sentence still renders.
            expect(screen.getByText(/Cinya's repairs scale off HP/)).toBeInTheDocument();
            // But not the false "unchanged" claim — Attack has nothing to do with the repair
            // finding, which the ATTACKER role doesn't host at all.
            expect(
                screen.queryByText(/No stat besides Attack feeds its active or charged basis/i)
            ).not.toBeInTheDocument();
            // The DAMAGE finding — the one ATTACKER DOES host — still gets its own equation line.
            expect(
                screen.getByText(/In its own numbers, this is Attack x0\.733 \+ Defence x0\.633/)
            ).toBeInTheDocument();
        });

        describe('Apply', () => {
            it('writes shipRole unchanged plus a damage roleBasis for Cobalt/ATTACKER', () => {
                mocked.mockImplementation(realDetect);
                const cobalt = corpusShipNamed('Cobalt');
                const onApply = vi.fn();
                render(
                    <OffFormulaNotice ship={cobalt} configuredRole="ATTACKER" onApply={onApply} />
                );
                fireEvent.click(screen.getByRole('button', { name: /use this/i }));
                expect(onApply).toHaveBeenCalledWith({
                    shipRole: 'ATTACKER',
                    roleBasis: {
                        produces: 'damage',
                        terms: [
                            { stat: 'attack', weight: closeTo(2.1) },
                            { stat: 'hp', weight: closeTo(0.267) },
                        ],
                    },
                });
                // The abandoned design nulled `shipRole` into Custom mode and wrote a seeded
                // `customFormula` — this update carries neither.
                const update = onApply.mock.calls[0][0] as OffFormulaApplyUpdate;
                expect('customFormula' in update).toBe(false);
            });

            // SUPPORTER's own core stat is HP, not Attack — Makoli's repair basis is
            // Defence-dominant (~19:1 over HP), so this pins that the written basis keeps its
            // real ratio rather than collapsing to a single term.
            it('writes a repair roleBasis for Makoli/SUPPORTER', () => {
                mocked.mockImplementation(realDetect);
                const makoli = corpusShipNamed('Makoli');
                const onApply = vi.fn();
                render(
                    <OffFormulaNotice ship={makoli} configuredRole="SUPPORTER" onApply={onApply} />
                );
                fireEvent.click(screen.getByRole('button', { name: /use this/i }));
                const update = onApply.mock.calls[0][0] as OffFormulaApplyUpdate;
                expect(update.shipRole).toBe('SUPPORTER');
                expect(update.roleBasis.produces).toBe('repair');

                const hpWeight = update.roleBasis.terms.find((t) => t.stat === 'hp')!.weight;
                const defWeight = update.roleBasis.terms.find((t) => t.stat === 'defence')!.weight;
                expect(defWeight / hpWeight).toBeCloseTo(18.72, 1);
            });

            it("offers no Apply and no equation line for Panon's damage basis under DEFENDER, his own default role", () => {
                mocked.mockImplementation(realDetect);
                const panon = corpusShipNamed('Panon');
                const onApply = vi.fn();
                render(
                    <OffFormulaNotice ship={panon} configuredRole="DEFENDER" onApply={onApply} />
                );
                expect(screen.queryByRole('button', { name: /use this/i })).not.toBeInTheDocument();
                // Panon's real damage basis is Attack x2.275 + Defence x1.775 (asserted directly
                // against `deriveBasis` in the corpus walk below) — this is what must NOT render.
                expect(screen.queryByText(/In its own numbers/)).not.toBeInTheDocument();
                expect(screen.queryByText(/add it by hand/i)).not.toBeInTheDocument();
                // The finding itself is the only thing DEFENDER keeps.
                expect(
                    screen.getByText(
                        /The Defender formula scores it only as part of a total it can trade away for another stat/
                    )
                ).toBeInTheDocument();
            });

            // The routing bug this task exists to close: Apply must select the finding whose
            // `produces` the ROLE hosts, never whichever finding sits first in the detector's
            // array. `detectOffFormulaStats` is mocked here (not Cobalt's real findings) so the
            // array order is controlled directly: a `shield` finding sits before the `damage`
            // one, and ATTACKER hosts only `damage`. `findings[0].produces`-routing would read
            // `shield`, find ATTACKER doesn't host it, and withhold Apply; correct routing reads
            // `roleAxis('ATTACKER')` and reaches the `damage` finding regardless of position.
            it("picks the produces the role hosts, not the first finding in the detector's array", () => {
                const cobalt = corpusShipNamed('Cobalt');
                mocked.mockReturnValue([
                    {
                        stat: 'shield',
                        produces: 'shield',
                        severity: 'severe',
                        trigger: 'on-cast',
                        tunableStat: 'shield',
                    },
                    {
                        stat: 'attack',
                        produces: 'damage',
                        severity: 'severe',
                        trigger: 'on-cast',
                        tunableStat: 'attack',
                    },
                ]);
                const onApply = vi.fn();
                render(
                    <OffFormulaNotice ship={cobalt} configuredRole="ATTACKER" onApply={onApply} />
                );
                fireEvent.click(screen.getByRole('button', { name: /use this/i }));
                const update = onApply.mock.calls[0][0] as OffFormulaApplyUpdate;
                expect(update.roleBasis.produces).toBe('damage');
            });
        });

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

        // The general invariant, over the real flagged corpus (real `detectOffFormulaStats`, not
        // a hand-written finding) x every role: Apply is offered iff `configuredRole` hosts the
        // axis of the basis it would write (`roleHostsBasis`), and when offered, the written
        // basis's terms are exactly `deriveBasis(ship, produces).terms` for that hosted axis —
        // never a different finding's basis, regardless of where that finding sits in the
        // detector's array. Apply being absent is always an acceptable outcome; a present button
        // writing an axis the role doesn't host, or the wrong finding's terms, is not.
        describe('Apply — every real flagged (ship, role) pairing applies only the axis the role hosts', () => {
            it('withholds Apply where the role hosts nothing, and writes only the hosted axis where it does', () => {
                mocked.mockImplementation(realDetect);
                const roles = Object.keys(SHIP_TYPES);
                let offered = 0;
                let withheldNoHost = 0;
                let withheldEmptyBasis = 0;
                // The reachability check the parent review flagged: a walk where every offered
                // case already agrees with `findings[0].produces` cannot tell the old buggy
                // routing (`findings[0].produces`) apart from the correct one (`roleAxis(role)`)
                // — see the mocked unit test above for the case that DOES distinguish them.
                let orderDisagreements = 0;

                for (const ship of fullCorpus()) {
                    for (const role of roles) {
                        const findings = realDetect(ship, role);
                        if (findings.length === 0) continue;

                        const hostAxis = roleAxis(role);
                        const onApply = vi.fn();
                        const { unmount } = render(
                            <OffFormulaNotice ship={ship} configuredRole={role} onApply={onApply} />
                        );
                        const button = screen.queryByRole('button', { name: /use this/i });

                        if (!hostAxis) {
                            expect(
                                button,
                                `${ship.name}/${role}: role hosts nothing, Apply must be absent`
                            ).not.toBeInTheDocument();
                            withheldNoHost++;
                            unmount();
                            continue;
                        }

                        if (!button) {
                            // A hosting role, but no finding on that axis (or an empty basis) —
                            // nothing of substance to write. Not this invariant's concern.
                            withheldEmptyBasis++;
                            unmount();
                            continue;
                        }

                        fireEvent.click(button);
                        const update = onApply.mock.calls[0][0] as OffFormulaApplyUpdate;
                        expect(update.shipRole, `${ship.name}/${role}`).toBe(role);
                        expect(
                            roleHostsBasis(role, update.roleBasis.produces),
                            `${ship.name}/${role}: wrote produces '${update.roleBasis.produces}', which the role does not host`
                        ).toBe(true);
                        expect(
                            update.roleBasis.terms,
                            `${ship.name}/${role}: wrote terms that don't match deriveBasis for its own produces`
                        ).toEqual(deriveBasis(ship, update.roleBasis.produces).terms);

                        if (findings[0].produces !== hostAxis) orderDisagreements++;
                        offered++;
                        unmount();
                    }
                }

                // Non-vacuity: the sweep must actually exercise both outcomes, or a detector
                // regression that always returns [] (Apply forever absent) or always finds a
                // host (Apply forever shown) would pass this test for the wrong reason.
                expect(offered, 'the walk must offer Apply at least once').toBeGreaterThan(0);
                expect(
                    withheldNoHost + withheldEmptyBasis,
                    'the walk must withhold Apply at least once'
                ).toBeGreaterThan(0);

                // eslint-disable-next-line no-console
                console.log(
                    `Apply corpus walk: offered=${offered} withheldNoHost=${withheldNoHost} ` +
                        `withheldEmptyBasis=${withheldEmptyBasis} orderDisagreements=${orderDisagreements}`
                );
                // Renders the whole real corpus (150+ ships) x every role — comfortably under
                // 5s alone, but the default per-test timeout is tight under full-suite load
                // (matches roleSlotCoverage.test.ts's precedent for this shape of test).
            }, 20000);
        });

        // The DISPLAY-path counterpart to the Apply corpus walk above: for every real flagged
        // (ship, role) pairing, a finding's equation line must render iff that finding's own
        // `produces` is the axis the role hosts — never merely because the role hosts SOMETHING.
        describe('Equation line only attaches to the finding whose axis the role hosts', () => {
            it('renders no equation line for a finding on an axis the role does not host, and does not silence the one it does', () => {
                mocked.mockImplementation(realDetect);
                const roles = Object.keys(SHIP_TYPES);
                // Non-vacuity for the negative assertion below: a ship carrying a finding whose
                // `produces` differs from a hosting role's own axis (e.g. Cinya's `repair`
                // finding under ATTACKER, which hosts `damage`). Zero would mean the walk never
                // actually exercised the bug this test guards against.
                let mixedProducesUnderHostingRole = 0;
                // Non-vacuity for the positive assertion: a hosted, leverable finding that DOES
                // get its equation line — proves the fix didn't just silence every line.
                let hostedEquationRendered = 0;

                for (const ship of fullCorpus()) {
                    for (const role of roles) {
                        const findings = realDetect(ship, role);
                        if (findings.length === 0) continue;

                        const hostAxis = roleAxis(role);
                        const { container, unmount } = render(
                            <OffFormulaNotice ship={ship} configuredRole={role} />
                        );

                        const card = container.querySelector('.card');
                        expect(
                            card,
                            `${ship.name}/${role}: findings present but no notice rendered`
                        ).toBeTruthy();
                        // Each finding renders as its own direct-child `div`; the excluded-carrier
                        // block (present only when passive carriers exist) is the lone direct
                        // child with a `border-t` divider, so filtering it out leaves exactly one
                        // div per finding, in the same order `findings` reports them.
                        const findingDivs = Array.from(card!.children).filter(
                            (el): el is Element =>
                                el.tagName === 'DIV' && !el.className.includes('border-t')
                        );
                        expect(findingDivs.length, `${ship.name}/${role}`).toBe(findings.length);

                        findings.forEach((finding, i) => {
                            const hasEquationParagraph =
                                findingDivs[i].querySelectorAll('p').length > 1;

                            if (finding.produces !== hostAxis) {
                                if (hostAxis) mixedProducesUnderHostingRole++;
                                expect(
                                    hasEquationParagraph,
                                    `${ship.name}/${role}: finding produces '${finding.produces}' isn't the hosted axis ('${hostAxis}') but still rendered an equation line`
                                ).toBe(false);
                            } else if (finding.tunableStat) {
                                // A hosted finding with a lever always has SOME basis to render
                                // against — this is the counterpart to the negative check above,
                                // over the same corpus walk rather than a single hand-picked ship.
                                expect(
                                    hasEquationParagraph,
                                    `${ship.name}/${role}: hosted finding with a lever rendered no equation line`
                                ).toBe(true);
                                hostedEquationRendered++;
                            }
                        });

                        unmount();
                    }
                }

                expect(
                    mixedProducesUnderHostingRole,
                    'the walk must encounter a mixed-produces finding under a hosting role at least once'
                ).toBeGreaterThan(0);
                expect(
                    hostedEquationRendered,
                    'the walk must render at least one genuinely hosted equation line'
                ).toBeGreaterThan(0);

                // eslint-disable-next-line no-console
                console.log(
                    `Equation-line corpus walk: mixedProducesUnderHostingRole=${mixedProducesUnderHostingRole} ` +
                        `hostedEquationRendered=${hostedEquationRendered}`
                );
            }, 20000);
        });
    }
);
