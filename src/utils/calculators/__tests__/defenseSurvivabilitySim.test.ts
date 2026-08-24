import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import {
    simulateDefenseSurvivability,
    DefenseSimulationInput,
    DefenderStats,
} from '../defenseSurvivabilitySim';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `d${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const skills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

const DEFENDER: DefenderStats = {
    hp: 100_000,
    defence: 0, // defence 0 keeps incoming arithmetic exact and readable
    security: 70,
    attack: 0, // attack 0 so the defender cannot kill an enemy and shorten its own window
    crit: 0,
    critDamage: 0,
    speed: 100,
    hacking: 200,
    healModifier: 0,
};

const BASE = (overrides: Partial<DefenseSimulationInput> = {}): DefenseSimulationInput => ({
    defender: DEFENDER,
    shipSkills: { slots: [] },
    selfBuffs: [],
    chargeCount: 0,
    startCharged: false,
    enemies: [],
    rounds: 5,
    ...overrides,
});

/** One attacker, `attack` per round, no kit — the pressure source for every case below. */
const attacker = (attack: number) => ({
    id: 'e1',
    stats: { attack, crit: 0, critDamage: 0, speed: 50, hp: 1_000_000, defence: 0 },
    chargeCount: 0,
    startCharged: false,
});

describe('simulateDefenseSurvivability', () => {
    // ── THE DOUBLE-COUNT TRIPWIRE ────────────────────────────────────────────
    // A SHIELDED fixture is mandatory here. On an unshielded run shieldAbsorbed is 0, so the
    // correct formula and the double-counting one agree and the bug ships green.
    //
    // #358 ADDENDUM 2 — WHY `measuredEHP === gross` STILL HOLDS HERE. `measuredEHP` now reads the
    // RAW (pre-defence) axis while `gross` stays post-mitigation, so the two coincide only at zero
    // effective defence — which `DEFENDER.defence: 0` guarantees for this fixture. The equality is
    // therefore still the right assertion for the double-count trap it was written for, but it is
    // NOT a statement that the two axes are the same thing. See the addendum-2 block at the bottom
    // of this file for the axis separation; add defence here and this line must change.
    it('measured EHP is GROSS intake — it does NOT add shield/barrier absorption on top', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                enemies: [attacker(5_000)],
                // Self-shield each turn → a real, non-zero shieldAbsorbed to double-count.
                shipSkills: skills([
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );

        const gross = result.rounds.reduce((s, r) => s + r.incomingDamage, 0);
        const absorbed = result.rounds.reduce(
            (s, r) => s + r.shieldAbsorbed + r.barrierAbsorbed + r.convertedToShield,
            0
        );

        // The fixture must actually exercise the trap, or this test proves nothing.
        expect(absorbed).toBeGreaterThan(0);

        expect(result.measuredEHP).toBe(gross);
        // The explicit negative: the inflated formula must NOT be what we report.
        expect(result.measuredEHP).not.toBe(gross + absorbed);
    });

    // ── SURVIVED VS DESTROYED, BOTH WAYS ─────────────────────────────────────
    it('survivor: survived true, no destroyedRound, EHP is the absorbed total', () => {
        idCounter = 0;
        // 1000/round vs 100k HP over 3 rounds — cannot die.
        const result = simulateDefenseSurvivability(
            BASE({ rounds: 3, enemies: [attacker(1_000)] })
        );
        expect(result.survived).toBe(true);
        expect(result.destroyedRound).toBeUndefined();
        // 3 rounds x 1,000 THROWN. Unchanged by addendum 2 only because this fixture's defence is
        // 0 — with defence the raw figure would stay 3,000 while the post-mitigation one fell.
        expect(result.measuredEHP).toBe(3_000);
        expect(result.elapsedRounds).toBe(3);
    });

    it('casualty: survived false and destroyedRound is set', () => {
        idCounter = 0;
        // 60k/round vs 100k HP, defence 0 → dead in round 2.
        const result = simulateDefenseSurvivability(
            BASE({ rounds: 5, enemies: [attacker(60_000)] })
        );
        expect(result.survived).toBe(false);
        expect(result.destroyedRound).toBe(2);
        // EHP counts only the rounds that actually elapsed, not the configured window.
        // 2 rounds x 60,000 THROWN (addendum 2's raw axis; identical here at defence 0).
        expect(result.measuredEHP).toBe(120_000);
    });

    // ── BREAKDOWN RECONCILED AGAINST AN INDEPENDENT SIGNAL ───────────────────
    // NOT `toHp + toShield + toBarrier + toConversion === gross` — toHp is DEFINED by that
    // subtraction, so that assertion is tautological. Cross-check against the HP trajectory
    // instead, on a run with NO healing of any kind (healing legitimately breaks the
    // reconciliation, and a team-supported fixture here would invite "fixing" correct code).
    it('breakdown toHp reconciles with the HP trajectory on a heal-free run', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(
            BASE({ rounds: 3, enemies: [attacker(10_000)] })
        );
        expect(result.breakdown.gross).toBe(30_000);
        expect(result.breakdown.toShield).toBe(0);
        expect(result.breakdown.toBarrier).toBe(0);
        expect(result.breakdown.toConversion).toBe(0);
        expect(result.breakdown.toHp).toBe(30_000);

        // Independent signal: the LAST round's entering HP% reflects the two rounds of damage
        // already taken (20k of 100k → 80%), so the derived HP loss and the engine's own HP bar
        // agree without either being computed from the other.
        expect(result.rounds[2].hpPct).toBe(80);
    });

    it('a shielded run splits the breakdown: some to shield, the rest to HP', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                enemies: [attacker(5_000)],
                shipSkills: skills([
                    ab({
                        type: 'shield',
                        target: 'self',
                        config: { type: 'shield', pct: 10, basis: 'hp' },
                    }),
                ]),
            })
        );
        expect(result.breakdown.toShield).toBeGreaterThan(0);
        expect(result.breakdown.toHp).toBeLessThan(result.breakdown.gross);
        expect(result.breakdown.toHp).toBeGreaterThanOrEqual(0);
    });

    it('no enemies: zero pressure, survived, EHP 0', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(BASE({ rounds: 3, enemies: [] }));
        expect(result.measuredEHP).toBe(0);
        expect(result.survived).toBe(true);
        expect(result.breakdown.gross).toBe(0);
    });

    // ── BARRIER IS ITS OWN CHANNEL ───────────────────────────────────────────
    it('Barrier blocks into toBarrier, never into toShield', () => {
        idCounter = 0;
        // Barrier ('Is invulnerable to damage.', constants/buffs.ts:790) is full immunity and never
        // drains the shield pool — barrierAbsorbed and shieldAbsorbed are separate channels.
        const result = simulateDefenseSurvivability(
            BASE({
                rounds: 2,
                enemies: [attacker(5_000)],
                shipSkills: skills([
                    ab({
                        type: 'buff',
                        target: 'self',
                        config: {
                            type: 'buff',
                            buffName: 'Barrier',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 'recurring',
                        },
                    }),
                ]),
            })
        );
        expect(result.breakdown.toBarrier).toBeGreaterThan(0);
        expect(result.breakdown.toShield).toBe(0);
        // Gross still counts the blocked hits: they ARRIVED, they were just nullified.
        expect(result.breakdown.gross).toBeGreaterThanOrEqual(result.breakdown.toBarrier);
    });

    // ── WHICH DEFENSIVE CHANNELS ACTUALLY REACH THE MEASURED NUMBER ───────────
    // The brief asked this test to prove an `incomingDamage`-channel MODIFIER aura reduces damage
    // taken (spec §1.1 gap 2: `modifier` abilities are not SkillEffects, so the pre-ability-model
    // flat auto-fill path could not see them at all). MEASURED, that is unachievable and the engine
    // says so in two places, deliberately:
    //
    //   • `modifierTotalsFromAbilities` (utils/abilities/applyAbilities.ts) has NO case for the
    //     'incomingDamage' channel — "'outgoingHeal' | 'incomingDamage' have no DPS bucket —
    //     ignore." `ModifierTotals` has no such field to fold into.
    //   • types/abilities.ts (the 'conditional-stat' doc): "`modifier` is percentage-only and folds
    //     ONLY into the attacker-side/DAMAGE-mode read (effectiveDamageStatsOf via
    //     modifierTotalsFromAbilities), NEVER the defensive read."
    //
    // So this test measures the channels instead of assuming them. The one that WORKS is the
    // victim-side D-PR12 channel: a self-buff carrying `parsedEffects.incomingDamage`
    // ('Inc. Damage Down II' = '-30% Incoming Direct Damage', constants/buffs.ts:311), folded per
    // victim by `victimIncomingModifiers` → `toSelfIncomingDamageModifier` (engine.ts:7099). That is
    // the channel Task 5/6 must expect a defensive buff to move, and the one the gate test below
    // then proves a condition can suppress.
    //
    // FINDING A IS NOW FIXED (addendum A2). This test used to pin a SECOND equality: a defender's
    // own 'Defense Up II' left the measured number untouched, because the applied per-victim read
    // (`victimDefenseProfileOf`) took the BASE `stats.defence` while the only defence-modifier term
    // carried enemy-sourced debuffs. That pin was a tripwire for measured inertness, never a
    // blessing of it, and the fix deleted it rather than loosening it — the `defenceUp` arm below
    // now asserts the buff REDUCES intake, by the exact figure the old pin's own comment predicted.
    //
    // The one remaining EQUALITY (finding B, the `modifier` channel) stays a tripwire. It is
    // PRE-EXISTING and out of scope. NOTE on `isMultiplicative`: a documented NO-OP — set false,
    // never surface it as a toggle.
    it('self-buffs on the incoming-damage AND defence channels reduce measured intake; the modifier channel is inert', () => {
        // Non-zero base defence so the Defense Up pin multiplies something real.
        const armoured = { ...DEFENDER, defence: 5_000 };
        const mkRun = (abilities: Ability[]) => {
            idCounter = 0;
            return simulateDefenseSurvivability(
                BASE({
                    rounds: 3,
                    defender: armoured,
                    enemies: [attacker(20_000)],
                    shipSkills: skills(abilities),
                })
            );
        };

        const plain = mkRun([]);
        const warded = mkRun([
            ab({
                type: 'buff',
                target: 'self',
                config: {
                    type: 'buff',
                    buffName: 'Inc. Damage Down II',
                    parsedEffects: { incomingDamage: -30 },
                    stacks: 1,
                    isStackable: false,
                    duration: 'recurring',
                },
            }),
        ]);
        const modifierAura = mkRun([
            ab({
                type: 'modifier',
                target: 'self',
                config: {
                    type: 'modifier',
                    channel: 'incomingDamage',
                    value: -50,
                    isMultiplicative: false,
                },
            }),
        ]);
        const defenceUp = mkRun([
            ab({
                type: 'buff',
                target: 'self',
                config: {
                    type: 'buff',
                    buffName: 'Defense Up II',
                    parsedEffects: { defense: 30 },
                    stacks: 1,
                    isStackable: false,
                    duration: 'recurring',
                },
            }),
        ]);

        // 20k attack vs defence 5000 → 8331/round; three rounds → 24993.
        expect(plain.breakdown.gross).toBe(24_993);
        // −30% incoming → 5832/round → 17496. The ability model DOES carry a defensive buff into
        // the measured number.
        expect(warded.breakdown.gross).toBe(17_496);
        expect(warded.breakdown.gross).toBeLessThan(plain.breakdown.gross);
        // FINDING B: the 'incomingDamage' MODIFIER channel has no defensive bucket at all.
        expect(modifierAura.breakdown.gross).toBe(plain.breakdown.gross);
        // FINDING A, FIXED (addendum A2): a defender's own '+30% Defense' now folds into the same
        // per-victim `defenceModifierPct` channel an enemy's Defense Shred rides, so the applied
        // read mitigates on 5000 x 1.30 = 6500. 7064/round instead of 8331 -> 21192 over three
        // rounds. That is precisely the number the pre-fix probe predicted for "a defender with
        // base defence 6500" while the applied damage was still stuck at the base-5000 value.
        //
        // DIRECTION, not just magnitude. `defenceModifierPct` is a SIGNED channel and the consumer
        // is `v.defence * (1 + pct/100)`; a term folded in with the wrong sign would turn Defense Up
        // into a debuff and STILL move this number off `plain`. The exact figure above pins WHICH
        // WAY only because 21192 happens to be the reduced value — so assert the direction outright
        // rather than leaving it implied by a constant a future re-measure might re-bless.
        expect(defenceUp.breakdown.gross).toBe(21_192);
        expect(defenceUp.breakdown.gross).toBeLessThan(plain.breakdown.gross);
    });

    // ── toConversion IS NOT INERT ────────────────────────────────────────────
    // Measured on Task 1: all 194 `convertedToShield` values in the healing golden suite are 0 —
    // NO scenario anywhere exercises Shield Converter. So without this test the breakdown's fourth
    // term would ship having never been observed non-zero, which is the same vacuity class as the
    // double-count tripwire above. `Shield Converter` is NAME-KEYED (utils/combat/shieldConverter.ts,
    // `SHIELD_CONVERTER = 'Shield Converter'`), granted by Quixilver's charged skill; it nullifies
    // the next DIRECT hit and turns it into Shield. See
    // src/utils/combat/__tests__/shieldConverter.integration.test.ts for a working grant fixture and
    // copy its shape.
    //
    // FIXTURE CORRECTION (Task 2): `duration` MUST be a NUMBER, not 'recurring'.
    // `holdsShieldConverter` (shieldConverter.ts) reads `timedAbilityStatuses('self', id)` ONLY —
    // deliberately, so a hand-picked/always-active Shield Converter cannot become a permanent
    // nullifier that `removeSelfBuffByName` can never spend. A `duration: 'recurring'` grant is an
    // AURA, so it is invisible to that read: measured, it produced convertedToShield 0 in all 3
    // rounds while `duration: 99` produced 8331 in all 3. The integration test uses 99 for exactly
    // this reason.
    it('Shield Converter damage lands in toConversion, not toShield or toHp', () => {
        idCounter = 0;
        const result = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                enemies: [attacker(5_000)],
                shipSkills: skills([
                    ab({
                        type: 'buff',
                        target: 'self',
                        config: {
                            type: 'buff',
                            buffName: 'Shield Converter',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 99,
                        },
                    }),
                ]),
            })
        );
        // The whole point: this term must be provably reachable.
        expect(result.breakdown.toConversion).toBeGreaterThan(0);
        // It is netted against gross exactly as Barrier is — gross still counts the nullified hit.
        expect(result.breakdown.gross).toBeGreaterThanOrEqual(result.breakdown.toConversion);
    });

    // ── THE NON-VACUOUS PROOF THE ABILITY MODEL CHANGED THE ANSWER ───────────
    // This is the test that closes #358. Under the old flat `buildSkillBuffAutoFill` path both runs
    // below were IDENTICAL — that path cannot express a gate, so it applied every parsed buff
    // unconditionally. If these two numbers match, the ability model is not reaching the engine and
    // the epic has demonstrated nothing.
    //
    // FIXTURE HISTORY (Task 2 -> addendum A2): the brief gated a 'Defense Up II'
    // (`parsedEffects.defense`) buff, but at the time that buff moved NOTHING on either run (both
    // 24993 — the pre-fix finding A), so the comparison was zero-vs-zero and could never have
    // proven anything either way. It was swapped to 'Inc. Damage Down II' as a workaround. The A2
    // fix made the defence channel live, so this is now REVERTED to its intended and strictly
    // stronger form: it proves a gated *defence* buff is suppressed, not merely that some channel
    // is. The test's SHAPE is unchanged throughout: same ship, same pressure, same unmet
    // `hp-threshold` gate, same strict inequality.
    it('a conditionally-gated defensive buff does NOT apply while its condition is unmet', () => {
        // Non-zero base defence, and load-bearing here in a way it is not for the incoming-damage
        // channel: a `defense` buff is a MULTIPLIER on the defence stat, so at defence 0 the gated
        // and ungated runs would be identical no matter whether the gate worked. Keeps this
        // fixture's arithmetic identical to the channel test above, so the two are directly
        // comparable (ungated 21192 / gated 24993 = plain).
        const armoured = { ...DEFENDER, defence: 5_000 };
        const defenseUp = {
            type: 'buff' as const,
            buffName: 'Defense Up II', // '+30% Defense' — constants/buffs.ts:51
            parsedEffects: { defense: 30 },
            stacks: 1,
            isStackable: false,
            duration: 'recurring' as const,
        };

        idCounter = 0;
        const ungated = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                defender: armoured,
                enemies: [attacker(20_000)],
                shipSkills: skills([ab({ type: 'buff', target: 'self', config: defenseUp })]),
            })
        );

        idCounter = 0;
        const gated = simulateDefenseSurvivability(
            BASE({
                rounds: 3,
                defender: armoured,
                enemies: [attacker(20_000)],
                shipSkills: skills([
                    ab({
                        type: 'buff',
                        target: 'self',
                        config: defenseUp,
                        // The defender starts at 100% HP, so "self HP below 30%" is unmet.
                        conditions: [
                            {
                                subject: 'hp-threshold',
                                hpSubject: 'self',
                                hpComparator: 'below',
                                hpPercent: 30,
                                derivable: true,
                            },
                        ],
                    }),
                ]),
            })
        );

        // The ungated run is genuinely mitigating, or the comparison proves nothing: 7064/round
        // (defence 5000 x 1.30 = 6500) instead of the unmitigated 8331 — not merely non-zero, the
        // mitigated value exactly.
        expect(ungated.breakdown.gross).toBe(21_192);
        // Gate unmet → the buff never applies → each hit lands at full strength → strictly more
        // damage taken, and exactly the no-buff figure.
        expect(gated.breakdown.gross).toBe(24_993);
        expect(gated.breakdown.gross).toBeGreaterThan(ungated.breakdown.gross);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #358 ADDENDUM 2 — `measuredEHP` counts RAW damage withstood
//
// THE DESIGN ERROR THIS BLOCK EXISTS TO FENCE. `measuredEHP` used to be Σ `incomingDamage`, which
// the engine records POST defence mitigation (the funnel's own doc: "the DEFENCE mitigation factor
// the CALLER already folded into `rawDamage`"). So it counted damage that got THROUGH, and a
// tankier ship reported a SMALLER number — while the page ranks highest-first. The ranking was
// inverted. Measured live on Isha: 1,408 against a static-formula 543,950.
//
// WHY EVERY PROPERTY BELOW IS PINNED HERE. Before this block, NOTHING in the repo gated the
// direction. Measured, not assumed: every pre-existing `measuredEHP` assertion in this file sits on
// a `defence: 0` fixture (where raw and post coincide exactly), and the two fixtures that DO carry
// defence assert on `breakdown.gross`, which stays on the post-mitigation axis by design. Applying
// the whole fix moved ZERO assertions in this file and ZERO in
// `selfDefenceBuffMitigation.test.ts`. A re-inversion would have shipped green.
//
// THE BREAKDOWN STAYS POST-MITIGATION (spec B3). `toHp`/`toShield`/`toBarrier`/`toConversion`
// partition what ARRIVED, and `breakdown.gross` is their sum-basis. Re-basing them on raw would
// break that identity, so the headline and the breakdown are on DIFFERENT axes and must never be
// presented as if they summed.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('measuredEHP is RAW damage withstood (#358 addendum 2)', () => {
    /** A defence sweep on one fixture shape. `rounds`/`attack` decide which regime we are in. */
    const sweep = (opts: {
        rounds: number;
        attack: number;
        defence: number;
        abilities?: Ability[];
    }) => {
        idCounter = 0;
        return simulateDefenseSurvivability(
            BASE({
                rounds: opts.rounds,
                defender: { ...DEFENDER, defence: opts.defence },
                enemies: [attacker(opts.attack)],
                shipSkills: skills(opts.abilities ?? []),
            })
        );
    };

    // ── THE DIRECTION TEST (spec B3, mandatory) ───────────────────────────────────────────────
    //
    // MUST BE IN THE CASUALTY REGIME. Raw damage THROWN does not depend on the defender's defence;
    // only how many ROUNDS it survives does. So defence raises this number by buying rounds, which
    // only happens when the ship actually dies. The survivor regime is pinned separately below.
    //
    // A magnitude-only assertion cannot catch a re-inversion — the number still MOVES when the sign
    // flips. This is an ordered chain of strict inequalities, so only the direction satisfies it.
    it('DIRECTION: more defence RAISES measured EHP (casualty regime)', () => {
        const CASUALTY = { rounds: 30, attack: 60_000 };
        const d0 = sweep({ ...CASUALTY, defence: 0 });
        const d5k = sweep({ ...CASUALTY, defence: 5_000 });
        const d20k = sweep({ ...CASUALTY, defence: 20_000 });

        // LIVENESS: all three really died, or this is not the casualty regime and the chain below
        // would be measuring the survivor plateau instead.
        expect(d0.survived).toBe(false);
        expect(d5k.survived).toBe(false);
        expect(d20k.survived).toBe(false);

        // More defence → more rounds survived → more raw damage withstood.
        expect(d5k.measuredEHP).toBeGreaterThan(d0.measuredEHP);
        expect(d20k.measuredEHP).toBeGreaterThan(d5k.measuredEHP);
        expect(d5k.elapsedRounds).toBeGreaterThan(d0.elapsedRounds);
        expect(d20k.elapsedRounds).toBeGreaterThan(d5k.elapsedRounds);

        // Re-measured, not loosened. 60,000 thrown per round × rounds survived.
        expect(d0.measuredEHP).toBe(120_000); // 2 rounds
        expect(d5k.measuredEHP).toBe(300_000); // 5 rounds
        expect(d20k.measuredEHP).toBe(720_000); // 12 rounds

        // THE OLD METRIC, FOR CONTRAST — and the reason this fix exists. The post-mitigation axis
        // is pinned at roughly the ship's HP no matter how tanky it is, so it carried almost no
        // information about defence at all. Kept as an explicit demonstration rather than prose.
        expect(d0.breakdown.gross).toBe(120_000);
        expect(d5k.breakdown.gross).toBe(124_970);
        expect(d20k.breakdown.gross).toBe(106_716);
    });

    // ── THE SURVIVOR PLATEAU ──────────────────────────────────────────────────────────────────
    //
    // ⚠️ DELETE ME, DO NOT LOOSEN ME. This asserts an EQUALITY where a reader arriving from the
    // direction test above will expect an inequality, and that is DELIBERATE: over a fixed window a
    // survivor is hit the same number of times whatever its defence, and raw damage thrown is a
    // property of the ATTACKERS, not of the defender. The figure is a LOWER BOUND on durability,
    // not a death threshold — which is why the UI renders survivors distinctly.
    //
    // If the engine ever makes this non-flat, this test goes red BY DESIGN. That is a signal to
    // DELETE it along with the assumption it encodes — never to relax it into a `>=`, which would
    // silently re-admit the inversion this whole addendum removed.
    it('SURVIVOR PLATEAU: over a fixed window the figure is defence-INDEPENDENT (deliberate)', () => {
        const SURVIVOR = { rounds: 3, attack: 20_000 };
        const runs = [0, 5_000, 20_000].map((defence) => sweep({ ...SURVIVOR, defence }));

        // LIVENESS: nobody died, and defence really is doing something — the post-mitigation axis
        // falls hard across the same sweep. Without this the equality below would also hold for a
        // fixture where defence was inert, proving nothing.
        for (const r of runs) expect(r.survived).toBe(true);
        expect(runs[2].breakdown.gross).toBeLessThan(runs[0].breakdown.gross);

        // 3 rounds × 20,000 thrown, whatever the defender's defence.
        for (const r of runs) expect(r.measuredEHP).toBe(60_000);
    });

    // ── THE ROUND QUANTUM ─────────────────────────────────────────────────────────────────────
    //
    // Also DELETE-ME-DON'T-LOOSEN-ME. The metric only moves when the round of DEATH moves, so its
    // resolution is one round of enemy throughput. Two genuinely different ships that die on the
    // same round report the SAME headline. That is inherent to a round-based simulation, not a
    // defect — and it is why the owner's ruling pairs the figure with rounds survived in the
    // results block. Pinned so nobody later reads two equal numbers as a bug.
    it('ROUND QUANTUM: two defenders that die on the same round report the SAME figure', () => {
        const CASUALTY = { rounds: 30, attack: 60_000 };
        const plain = sweep({ ...CASUALTY, defence: 5_000 });
        const tankier = sweep({
            ...CASUALTY,
            defence: 5_000,
            abilities: [
                ab({
                    type: 'buff',
                    target: 'self',
                    config: {
                        type: 'buff',
                        buffName: 'Defense Up II',
                        parsedEffects: { defense: 30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                    },
                }),
            ],
        });

        // The buff IS live — it visibly reduces what got through — and yet both die on round 5.
        expect(tankier.breakdown.gross).toBeLessThan(plain.breakdown.gross);
        expect(tankier.destroyedRound).toBe(plain.destroyedRound);
        expect(tankier.measuredEHP).toBe(plain.measuredEHP);
    });

    // ── RAW >= POST, WITH THE EXACT EQUALITY CASE (spec B3, mandatory) ────────────────────────
    it('RAW >= POST always, with EXACT equality at zero effective defence', () => {
        // Strictly greater wherever defence bites…
        for (const defence of [1_000, 5_000, 20_000]) {
            const r = sweep({ rounds: 3, attack: 20_000, defence });
            expect(r.measuredEHP).toBeGreaterThan(r.breakdown.gross);
        }
        // …and EXACTLY equal at zero effective defence. Not `toBeCloseTo`: with nothing folded, the
        // funnel books the identical value on both axes.
        const undefended = sweep({ rounds: 3, attack: 20_000, defence: 0 });
        expect(undefended.breakdown.gross).toBeGreaterThan(0);
        expect(undefended.measuredEHP).toBe(undefended.breakdown.gross);
    });

    // ── THE BREAKDOWN STAYS ON THE POST-MITIGATION AXIS (spec B3) ─────────────────────────────
    it('the breakdown still partitions POST-mitigation intake, not the raw headline', () => {
        const r = sweep({ rounds: 3, attack: 20_000, defence: 5_000 });
        // The four terms close over `gross`, NOT over `measuredEHP` — the identity that would break
        // if a well-meaning change re-based the breakdown on the raw axis to make the card "add up".
        expect(
            r.breakdown.toHp +
                r.breakdown.toShield +
                r.breakdown.toBarrier +
                r.breakdown.toConversion
        ).toBeCloseTo(r.breakdown.gross, 6);
        // And the headline is on the OTHER axis — deliberately not equal to that sum.
        expect(r.measuredEHP).toBeGreaterThan(r.breakdown.gross);
    });
});
