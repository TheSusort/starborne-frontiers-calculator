import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects, TeamActorInput } from '../../../types/calculator';
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
    // #358 ADDENDUM 2 — WHY `damageAbsorbed === gross` STILL HOLDS HERE. `damageAbsorbed` now reads the
    // RAW (pre-defence) axis while `gross` stays post-mitigation, so the two coincide only at zero
    // effective defence — which `DEFENDER.defence: 0` guarantees for this fixture. The equality is
    // therefore still the right assertion for the double-count trap it was written for, but it is
    // NOT a statement that the two axes are the same thing. See the addendum-2 block at the bottom
    // of this file for the axis separation; add defence here and this line must change.
    it('damage absorbed is GROSS intake — it does NOT add shield/barrier absorption on top', () => {
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

        expect(result.damageAbsorbed).toBe(gross);
        // The explicit negative: the inflated formula must NOT be what we report.
        expect(result.damageAbsorbed).not.toBe(gross + absorbed);
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
        expect(result.damageAbsorbed).toBe(3_000);
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
        expect(result.damageAbsorbed).toBe(120_000);
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
        expect(result.damageAbsorbed).toBe(0);
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
// #358 ADDENDUM 2 — `damageAbsorbed` counts RAW damage withstood
//
// THE DESIGN ERROR THIS BLOCK EXISTS TO FENCE. `damageAbsorbed` used to be Σ `incomingDamage`, which
// the engine records POST defence mitigation (the funnel's own doc: "the DEFENCE mitigation factor
// the CALLER already folded into `rawDamage`"). So it counted damage that got THROUGH, and a
// tankier ship reported a SMALLER number — while the page ranks highest-first. The ranking was
// inverted. Measured live on Isha: 1,408 against a static-formula 543,950.
//
// WHY EVERY PROPERTY BELOW IS PINNED HERE. Before this block, NOTHING in the repo gated the
// direction. Measured, not assumed: every pre-existing `damageAbsorbed` assertion in this file sits on
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
describe('damageAbsorbed is RAW damage withstood (#358 addendum 2)', () => {
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
    it('DIRECTION (channel 1/5 — defence mitigation): more defence RAISES damage absorbed', () => {
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
        expect(d5k.damageAbsorbed).toBeGreaterThan(d0.damageAbsorbed);
        expect(d20k.damageAbsorbed).toBeGreaterThan(d5k.damageAbsorbed);
        expect(d5k.elapsedRounds).toBeGreaterThan(d0.elapsedRounds);
        expect(d20k.elapsedRounds).toBeGreaterThan(d5k.elapsedRounds);

        // Re-measured, not loosened. 60,000 thrown per round × rounds survived.
        expect(d0.damageAbsorbed).toBe(120_000); // 2 rounds
        expect(d5k.damageAbsorbed).toBe(300_000); // 5 rounds
        expect(d20k.damageAbsorbed).toBe(720_000); // 12 rounds

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
        for (const r of runs) expect(r.damageAbsorbed).toBe(60_000);
    });

    // ── THE QUANTUM IS ONE *HIT* — AND WITH ONE ATTACKER A HIT IS A ROUND ────────────────────
    //
    // Also DELETE-ME-DON'T-LOOSEN-ME, but READ THE SCOPE LINE FIRST. The metric only moves when the
    // ship survives one more INCOMING HIT; it never moves by the amount a reduction shaves off each
    // hit. `sweep` throws ONE attacker's ONE hit per round, so on THIS FIXTURE surviving a hit and
    // surviving a round are the same event and the equality below reads as a per-ROUND quantum.
    //
    // ⚠️ THAT EQUALITY IS FIXTURE-SPECIFIC AND DOES NOT GENERALISE. With more than one attacker a
    // round is several hits and the resolution is finer than a round: a reduction can carry the ship
    // past attacker 1's hit so that it also eats attacker 2's before dying, on the very same round.
    // The next test measures exactly that, and the docs/changelog wording was corrected because it
    // had generalised THIS arm's equality into a rule. Do not re-generalise it.
    it('ROUND QUANTUM (one attacker, one hit/round): two defenders dying on the same round tie', () => {
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
        expect(tankier.damageAbsorbed).toBe(plain.damageAbsorbed);
    });

    // ── SAME ROUND OF DEATH, DIFFERENT FIGURE (the multi-hit correction) ──────────────────────
    //
    // WHY THIS ARM EXISTS. The docs and the changelog claimed "two ships that die on the same round
    // report the same figure even if one is a little tankier". That was generalised from the ROUND
    // QUANTUM arm above, whose fixture throws exactly one hit per round — the one shape where it is
    // true. It is FALSE as a rule, and this arm is the measurement, not an inference:
    //
    //   Split the SAME per-round pressure across TWO attackers on different speeds. The fight ends
    //   with the turn that destroys the defender (#329), so the frailer ship's last round stops
    //   after attacker 1 and attacker 2 never fires at it. A reduction that carries the tankier ship
    //   through attacker 1's hit therefore buys it attacker 2's hit as well — one extra hit of raw
    //   intake, with the round of death UNCHANGED.
    //
    // MEASURED (hp 100,000, defence 5,000, two 40,000-attack attackers at speeds 60 and 50 — the
    // same 80,000 raw per round that a single 80,000-attack enemy throws):
    //     plain ................. destroyed round 4, absorbed 280,000   (7 hits)
    //     + `Defense Up II` ..... destroyed round 4, absorbed 320,000   (8 hits)
    // 40,000 apart: exactly one attacker's raw hit. Per-round raw for the plain run is
    // 80,000/80,000/80,000/40,000 — the truncated final round is directly visible.
    //
    // THE SINGLE-ATTACKER CONTROL IS PART OF THE MEASUREMENT, not decoration: one 80,000-attack
    // enemy over the same fixture gives BOTH ships 320,000, which is what makes this a statement
    // about the number of attackers rather than about the buff.
    it('SAME ROUND, DIFFERENT FIGURE: with two attackers a reduction buys a HIT, not a round', () => {
        const defender: DefenderStats = { ...DEFENDER, defence: 5_000 };
        const defUp = ab({
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
        });
        const run = (tanky: boolean, enemies: DefenseSimulationInput['enemies']) => {
            idCounter = 0;
            return simulateDefenseSurvivability(
                BASE({
                    rounds: 30,
                    defender,
                    enemies,
                    shipSkills: skills(tanky ? [defUp] : []),
                })
            );
        };
        // Distinct speeds so the two attackers act at distinct points inside the round — with equal
        // speeds the ordering carries no information and the whole mechanism is unobservable.
        const at = (id: string, speed: number) => ({
            ...attacker(40_000),
            id,
            stats: { ...attacker(40_000).stats, speed },
        });
        const split = [at('e1', 60), at('e2', 50)];

        const plain = run(false, split);
        const tankier = run(true, split);

        // The premise of the whole arm: SAME round of death. Without this the numbers below are just
        // the ordinary "defence buys a round" direction test.
        expect(plain.destroyedRound).toBe(4);
        expect(tankier.destroyedRound).toBe(4);
        expect(tankier.elapsedRounds).toBe(plain.elapsedRounds);

        // …and yet the figures differ, by exactly one attacker's raw hit.
        expect(plain.damageAbsorbed).toBe(280_000);
        expect(tankier.damageAbsorbed).toBe(320_000);
        expect(tankier.damageAbsorbed - plain.damageAbsorbed).toBe(40_000);

        // The truncated final round, shown rather than asserted around: three full rounds of both
        // attackers, then a round in which only the first one got to fire.
        expect(plain.rounds.map((r) => r.incomingDamageRaw)).toEqual([
            80_000, 80_000, 80_000, 40_000,
        ]);
        expect(tankier.rounds.map((r) => r.incomingDamageRaw)).toEqual([
            80_000, 80_000, 80_000, 80_000,
        ]);

        // THE CONTROL. Identical total pressure delivered by ONE attacker → the tie the arm above
        // pins. This is what localises the effect to the attacker COUNT.
        const soloPlain = run(false, [attacker(80_000)]);
        const soloTankier = run(true, [attacker(80_000)]);
        expect(soloPlain.destroyedRound).toBe(4);
        expect(soloTankier.destroyedRound).toBe(4);
        expect(soloPlain.damageAbsorbed).toBe(320_000);
        expect(soloTankier.damageAbsorbed).toBe(320_000);
    });

    // ── RAW >= POST, WITH THE EXACT EQUALITY CASE (spec B3, mandatory) ────────────────────────
    it('RAW >= POST always, with EXACT equality at zero effective defence', () => {
        // Strictly greater wherever defence bites…
        for (const defence of [1_000, 5_000, 20_000]) {
            const r = sweep({ rounds: 3, attack: 20_000, defence });
            expect(r.damageAbsorbed).toBeGreaterThan(r.breakdown.gross);
        }
        // …and EXACTLY equal at zero effective defence. Not `toBeCloseTo`: with nothing folded, the
        // funnel books the identical value on both axes.
        const undefended = sweep({ rounds: 3, attack: 20_000, defence: 0 });
        expect(undefended.breakdown.gross).toBeGreaterThan(0);
        expect(undefended.damageAbsorbed).toBe(undefended.breakdown.gross);
    });

    // ── THE BREAKDOWN STAYS ON THE POST-MITIGATION AXIS (spec B3) ─────────────────────────────
    it('the breakdown still partitions POST-mitigation intake, not the raw headline', () => {
        const r = sweep({ rounds: 3, attack: 20_000, defence: 5_000 });
        // The four terms close over `gross`, NOT over `damageAbsorbed` — the identity that would break
        // if a well-meaning change re-based the breakdown on the raw axis to make the card "add up".
        expect(
            r.breakdown.toHp +
                r.breakdown.toShield +
                r.breakdown.toBarrier +
                r.breakdown.toConversion
        ).toBeCloseTo(r.breakdown.gross, 6);
        // And the headline is on the OTHER axis — deliberately not equal to that sum.
        expect(r.damageAbsorbed).toBeGreaterThan(r.breakdown.gross);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #358 ADDENDUM 3 (C2/C5) — DAMAGE ABSORBED, DEFINED IN FULL
//
// WHY THIS BLOCK EXISTS AND THE ADDENDUM-2 BLOCK ABOVE WAS NOT ENOUGH. This is the THIRD iteration
// on this metric. Each of the previous two fixed exactly ONE mitigation channel and left the
// others, because nobody had written the definition down in full. The addendum-2 direction test
// swept only DEFENCE — so when the fix left the victim's own `Inc. Damage Down` folded into the
// pre-mitigation figure, a defender carrying it survived an EXTRA round and reported a LOWER
// number (252,000 over 6 rounds against a plain defender's 300,000 over 5). That inversion passed
// a full review and a green suite.
//
// C5's answer, and the shape of this block: **a direction arm PER VICTIM-SIDE CHANNEL**, each one
// proving that MORE reduction never yields LESS damage absorbed, plus **a presence arm per damage
// channel** proving DoT / bomb / detonation / reflect are actually IN the total rather than
// silently zero. A channel with no arm here is a channel that can invert again unnoticed.
//
// C2, for reference:
//   IN  — the attack as thrown: attacker outgoing buffs, crit, affinity, and enemy-APPLIED
//         amplification ('Out. Damage Up', 'Exposed'). Shield and Barrier absorption still count:
//         those pools eat damage that ARRIVED, they do not reduce what was thrown.
//   OUT — every victim-side reduction: defence mitigation, the ship's own `Inc. Damage Down`
//         family, `preFightIncoming`, `equipReductionPct`, and the incoming-block proc.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('damage absorbed — per-channel direction and presence (#358 addendum 3, C5)', () => {
    /** A passive slot: the incoming-* families are collected from PASSIVE slots only
     *  (`incomingAbilitiesById` in engine.ts filters `slot.slot !== 'passive'`). An arm that puts
     *  one of these in the active slot measures NOTHING — every figure comes back equal to the
     *  plain run and the test passes for the wrong reason. */
    const passives = (abilities: Ability[]): ShipSkills => ({
        slots: [{ slot: 'passive', abilities }],
    });

    const run = (opts: {
        rounds: number;
        attack: number;
        defence: number;
        shipSkills?: ShipSkills;
        enemyAbilities?: Ability[];
        defenderOverrides?: Partial<DefenderStats>;
    }) => {
        idCounter = 0;
        const enemy = {
            ...attacker(opts.attack),
            ...(opts.enemyAbilities
                ? {
                      shipSkills: {
                          slots: [{ slot: 'active' as const, abilities: opts.enemyAbilities }],
                      },
                  }
                : {}),
        };
        return simulateDefenseSurvivability(
            BASE({
                rounds: opts.rounds,
                defender: { ...DEFENDER, defence: opts.defence, ...opts.defenderOverrides },
                enemies: [enemy],
                shipSkills: opts.shipSkills ?? { slots: [] },
            })
        );
    };

    // The CASUALTY regime, where a victim-side reduction can show up at all: it buys ROUNDS, and
    // rounds are what raise the figure. 100,000 HP, 60,000/round, defence 5,000 → dies on round 5
    // and absorbs 300,000. Every direction arm below sweeps against exactly this baseline.
    const CASUALTY = { rounds: 30, attack: 60_000, defence: 5_000 };
    const PLAIN_ABSORBED = 300_000;
    const PLAIN_ROUNDS = 5;

    it('BASELINE: the unprotected casualty every direction arm below is measured against', () => {
        const plain = run(CASUALTY);
        expect(plain.survived).toBe(false);
        expect(plain.elapsedRounds).toBe(PLAIN_ROUNDS);
        expect(plain.damageAbsorbed).toBe(PLAIN_ABSORBED);
    });

    // ── CHANNEL 2/5: the victim's OWN `Inc. Damage Down` family (`selfIncoming`) ───────────────
    //
    // THE EXACT DEFECT C3 NAMES. Before the mixed-channel split, this arm read 252,000 over 6
    // rounds against the plain 300,000 over 5 — MORE protection, MORE rounds, LESS reported. The
    // `elapsedRounds` assertion is what makes the arm honest: it proves the buff is live and
    // really is buying survival, so a figure that fell could not be excused as "the buff did
    // nothing".
    it('DIRECTION (channel 2/5 — the ship’s own Inc. Damage Down): more protection, MORE absorbed', () => {
        const warded = run({
            ...CASUALTY,
            shipSkills: passives([
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
            ]),
        });
        // LIVENESS: the buff bought a round and visibly cut what got through.
        expect(warded.elapsedRounds).toBeGreaterThan(PLAIN_ROUNDS);
        expect(warded.breakdown.gross).toBeLessThan(run(CASUALTY).breakdown.gross);
        // DIRECTION, and the pinned figure: 6 rounds × 60,000 thrown.
        expect(warded.damageAbsorbed).toBeGreaterThan(PLAIN_ABSORBED);
        expect(warded.damageAbsorbed).toBe(360_000);
    });

    // ── CHANNEL 3/5: `preFightIncoming` (squad-leader incoming protections) ────────────────────
    //
    // NOT REACHABLE FROM THIS BOUNDARY — `DefenseSimulationInput` exposes no pre-fight block — so
    // it is fenced where it IS reachable, and the two halves together are the arm:
    //   • `preFightModifiersEngine.test.ts` proves the engine puts `preFight.incomingDamage` into
    //     `victimSideIncomingModifier`, the field the split travels on;
    //   • `victimDamage.test.ts`'s split block proves a value in that field lowers `damage` and
    //     leaves `preMitigation` alone.
    // `selfIncoming` and `preFightIncoming` are summed into that ONE field by
    // `victimIncomingModifiers`, so channel 2's engine-level arm above covers the summed term's
    // behaviour end to end and only the SOURCING differs. Kept as a comment rather than a skipped
    // test: a `.skip` reads as coverage in the count while proving nothing.

    // ── CHANNEL 4/5: `equipReductionPct` (D-PR3 gear-sourced incoming reduction) ───────────────
    it('DIRECTION (channel 4/5 — equipReductionPct): a flat incoming reduction RAISES absorbed', () => {
        const geared = run({
            ...CASUALTY,
            shipSkills: passives([
                ab({
                    type: 'incoming-reduction',
                    target: 'self',
                    config: {
                        type: 'incoming-reduction',
                        scope: 'direct',
                        condition: 'always',
                        pct: 30,
                        critFamily: false,
                    },
                }),
            ]),
        });
        expect(geared.elapsedRounds).toBeGreaterThan(PLAIN_ROUNDS);
        expect(geared.breakdown.gross).toBeLessThan(run(CASUALTY).breakdown.gross);
        expect(geared.damageAbsorbed).toBeGreaterThan(PLAIN_ABSORBED);
        expect(geared.damageAbsorbed).toBe(360_000);
    });

    // ── CHANNEL 5/5: the incoming-BLOCK proc (`damageRaw *= (1 - blocked)`) ────────────────────
    //
    // This channel had NO test anywhere (carried finding 7): deleting the raw-axis scaling left the
    // whole suite green. It is now DELETED BY DESIGN — a blocked hit was still thrown — and this
    // arm is what says so. `procChance: 1` + `blockPct: 0.5` makes the block deterministic, so the
    // pinned figure is not at the mercy of the rate gate.
    it('DIRECTION (channel 5/5 — the incoming-block proc): a blocked hit still counts as thrown', () => {
        const blocking = run({
            ...CASUALTY,
            shipSkills: passives([
                ab({
                    type: 'incoming-block',
                    target: 'self',
                    config: {
                        type: 'incoming-block',
                        condition: 'always',
                        procChance: 1,
                        blockPct: 0.5,
                        oncePerRound: false,
                    },
                }),
            ]),
        });
        expect(blocking.elapsedRounds).toBeGreaterThan(PLAIN_ROUNDS);
        expect(blocking.breakdown.gross).toBeGreaterThan(0);
        expect(blocking.damageAbsorbed).toBeGreaterThan(PLAIN_ABSORBED);
        // 9 rounds × 60,000 thrown in full. Restore `damageRaw *= (1 - blocked)` and this halves.
        expect(blocking.damageAbsorbed).toBe(540_000);
    });

    // ── CHANNEL 6: the DoT-reduction channel (Vortex Veil) ─────────────────────────────────────
    //
    // ⚠️ NOT IN C2'S EXPLICIT "OUT" LIST — a deliberate extension, flagged rather than smuggled.
    // C2's list names `equipReductionPct` (the DIRECT-damage half of D-PR3) but not
    // `incomingDotReductionPct` (its DoT half). Both are the defender reducing what it takes, and
    // C2's governing sentence is "measured BEFORE the defender reduces it", so leaving this one in
    // would have re-created the exact shape this addendum exists to end: a defensive ability
    // lowering its own owner's headline, on the one channel nobody had listed. Stripped, and
    // fenced here so the decision is visible instead of implicit.
    it('DIRECTION (channel 6 — Vortex Veil DoT reduction, an extension beyond C2’s list)', () => {
        const dotEnemy = [
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'inferno', tier: 45, stacks: 3, duration: 5 },
            }),
        ];
        const opts = {
            rounds: 4,
            attack: 10_000,
            defence: 5_000,
            enemyAbilities: dotEnemy,
            defenderOverrides: { security: 0 },
        };
        const plain = run(opts);
        const veiled = run({
            ...opts,
            shipSkills: passives([
                ab({
                    type: 'incoming-reduction',
                    target: 'self',
                    config: {
                        type: 'incoming-reduction',
                        scope: 'dot',
                        condition: 'always',
                        pct: 50,
                        critFamily: false,
                    },
                }),
            ]),
        });
        // LIVENESS: the veil really halves what ARRIVES…
        expect(plain.breakdown.gross).toBe(81_000);
        expect(veiled.breakdown.gross).toBe(40_500);
        // …and is invisible on the thrown axis. Equality, not `>=`: over a fixed survivor window
        // the same DoT is applied either way, so the thrown total is identical.
        expect(veiled.damageAbsorbed).toBe(plain.damageAbsorbed);
        expect(veiled.damageAbsorbed).toBe(81_000);
    });

    // ── CHANNEL 7: the DoT-TRANSFORM deferral (C4 — Voron/Orel, Hit Mitigation) ────────────────
    //
    // Was mis-filed "corpus-inert". It is reachable from the live page, and it was the single
    // largest distortion of the metric: MEASURED, a Voron defender at 5,000 defence reported
    // 24,993 where a plain defender reported 100,000 — a purely DEFENSIVE ability quartering its
    // owner's headline. See `convertHitToSelfDot` for the two wrong fixes and why the raw axis is
    // now booked at THROW time.
    //
    // The gross assertions are the liveness proof, and they must stay: they are the only thing in
    // this arm that can tell "the transform fired and was accounted for" from "the transform never
    // fired at all" — both of which leave `damageAbsorbed` at 100,000.
    it('CHANNEL 7 — a Voron-style DoT transform does not shrink the figure (C4)', () => {
        const opts = { rounds: 5, attack: 20_000, defence: 5_000 };
        const plain = run(opts);
        const voron = run({
            ...opts,
            shipSkills: passives([
                ab({
                    type: 'transform-incoming-to-dot',
                    target: 'self',
                    trigger: 'on-attacked',
                    config: { type: 'transform-incoming-to-dot', turns: 3, condition: 'always' },
                }),
            ]),
        });
        // LIVENESS: the transform fired — it deferred damage past the end of the window, so far
        // less ARRIVED (24,993 against the plain run's 41,655).
        expect(plain.breakdown.gross).toBe(41_655);
        expect(voron.breakdown.gross).toBe(24_993);
        // DIRECTION: 5 rounds × 20,000 were thrown at both ships, and both report it.
        expect(voron.damageAbsorbed).toBe(plain.damageAbsorbed);
        expect(voron.damageAbsorbed).toBe(100_000);
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // THE **KEEP** HALF OF THE SPLIT (#358 addendum 3, carried finding 3)
    //
    // Every arm above this line proves the same shape: a victim-side REDUCTION must not lower the
    // figure. Not one of them could tell that apart from "strip the whole incoming channel", which
    // is the OTHER way to get this metric wrong — and MEASURED, it was completely unfenced:
    // mutating the engine's population site to `victimSideIncomingModifier: selfIncoming +
    // preFightIncoming + exposed` (i.e. over-stripping the attacker's own amplification) left all
    // 584 files / 6520 tests GREEN, and the `+ enemy.incomingDamageModifier` mutation moved one
    // incidental snapshot and nothing else.
    //
    // These two arms are that fence, and they sit at the ENGINE population site rather than the
    // damage site: `victimDamage.test.ts` proves `victimHitDamageParts` honours the split it is
    // HANDED, which is a different claim from "the engine hands it the right split". A single
    // `+ exposed` in `victimIncomingModifiers` satisfies the first and violates the second.
    //
    // WHY THE DEBUFF CLAUSE COMES FIRST in each ability list: clauses resolve in WRITTEN order, so
    // a debuff placed after the damage clause misses the cast that applies it (locked rule, #289) —
    // which would leave round 1 unamplified and turn a clean ×N into an off-by-one-round ratio.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    const basicHit = () =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // A SURVIVOR window on purpose: with the round count nailed down, the only thing that can move
    // the figure is the per-hit amplification itself, so the ratio is readable.
    const KEEP = { rounds: 4, attack: 10_000, defence: 5_000 };

    it('KEEP (enemy-applied Inc./Out. Damage Up): amplification RAISES absorbed', () => {
        const plain = run({ ...KEEP, enemyAbilities: [basicHit()] });
        const amped = run({
            ...KEEP,
            enemyAbilities: [
                ab({
                    type: 'debuff',
                    target: 'enemy',
                    config: {
                        type: 'debuff',
                        buffName: 'Inc. Damage Up',
                        parsedEffects: { incomingDamage: 50 },
                        stacks: 1,
                        isStackable: false,
                        application: 'apply',
                        duration: 5,
                    },
                }),
                basicHit(),
            ],
        });
        // LIVENESS: both ships lived the whole window, so no round-count effect is in play.
        expect(plain.survived).toBe(true);
        expect(amped.survived).toBe(true);
        expect(amped.elapsedRounds).toBe(plain.elapsedRounds);
        // The amplification is real on the axis that measures what ARRIVED…
        expect(amped.breakdown.gross).toBeGreaterThan(plain.breakdown.gross);
        // …and it must be just as real on the THROWN axis: the enemy's side applied it, so it is
        // part of the attack, not a reduction. Move `enemy.incomingDamageModifier` into
        // `victimSideIncomingModifier` and this collapses back to the plain figure.
        expect(amped.damageAbsorbed).toBeGreaterThan(plain.damageAbsorbed);
        expect(plain.damageAbsorbed).toBe(40_000);
        expect(amped.damageAbsorbed).toBe(60_000);
    });

    it('KEEP (Exposed): a name-keyed one-shot amplification RAISES absorbed', () => {
        const plain = run({ ...KEEP, enemyAbilities: [basicHit()] });
        const exposed = run({
            ...KEEP,
            enemyAbilities: [
                ab({
                    type: 'debuff',
                    target: 'enemy',
                    config: {
                        type: 'debuff',
                        buffName: 'Exposed',
                        // NAME-keyed: Exposed carries no `parsedEffects.incomingDamage` on purpose
                        // (exposedStatus.ts) — the engine reads the NAME at the per-victim fold.
                        // An arm built on parsedEffects would be testing Inc. Damage Up twice.
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        application: 'apply',
                        duration: 2,
                    },
                }),
                basicHit(),
            ],
        });
        expect(plain.survived).toBe(true);
        expect(exposed.survived).toBe(true);
        expect(exposed.elapsedRounds).toBe(plain.elapsedRounds);
        expect(exposed.breakdown.gross).toBeGreaterThan(plain.breakdown.gross);
        // +100% per armed hit, on BOTH axes. Add `+ exposed` to the engine's
        // `victimSideIncomingModifier` and only this assertion falls.
        expect(exposed.damageAbsorbed).toBeGreaterThan(plain.damageAbsorbed);
        expect(plain.damageAbsorbed).toBe(40_000);
        expect(exposed.damageAbsorbed).toBe(80_000);
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // CHANNEL 9: the Protection redirect (`cascade.targetRetainedFraction`)
    //
    // ⚠️ OPEN GAME-SEMANTICS QUESTION, PINNED RATHER THAN DECIDED. This is the second of the two
    // funnel scalings C5 named as untested (`(1 - blocked)` is channel 5/5 above); deleting either
    // left the whole suite green. This arm closes the second one — and in doing so it MEASURED a
    // channel that C2 does not list on either side of its IN/OUT ledger:
    //
    //   4-round survivor window, 10,000/round, defender defence 5,000 —
    //     no protector ally .................... absorbed 40,000
    //     ally holding 0 Protection stacks ..... absorbed 40,000   (control: the ally alone is inert)
    //     ally holding 3 stacks (30%) .......... absorbed 28,000
    //     ally holding 5 stacks (50%) .......... absorbed 20,000
    //   Identical round counts, identical survival, HALF the headline.
    //
    // Shape-wise that is indistinguishable from the four inversions this addendum exists to end.
    // It is NOT obviously the same defect, which is exactly why it is not being changed here:
    //   • FOR counting it — the damage WAS thrown at this ship. C2's governing sentence is
    //     "everything thrown at the ship … before the defender reduces it", and a Protection grant
    //     is a defensive mechanic that currently lowers its beneficiary's own headline.
    //   • AGAINST counting it — a redirect is a REASSIGNMENT, not a reduction: the slice is booked
    //     in full on the PROTECTOR's own raw axis (rawIntakeAxis.test.ts path 7), so counting it on
    //     both would double-count it across the board, and "absorbed" arguably names the ship that
    //     actually ate it.
    // Deciding that is a game/product ruling, not something to infer from the neighbouring
    // channels — a locked ruling about a different clause is still a guess here. So: current
    // behaviour PINNED with the numbers above, the scaling now has the test C5 asked for, and the
    // question is written down where the next reader will meet it.
    // ══════════════════════════════════════════════════════════════════════════════════════════
    const protectorAlly = (stacks: number): TeamActorInput => ({
        id: 'ally1',
        speed: 90,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        // ABILITY-granted, not a scheduled `selfBuffs` entry: `hasAnyProtectionGrant` gates the
        // whole cascade, and MEASURED, a `SelectedGameBuff` named 'Protection' on a team actor
        // never reaches `selfBuffStacksForOwner` — that build reported 40,000 at every stack count
        // and would have "proved" the channel inert.
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Protection',
                                parsedEffects: {},
                                stacks,
                                isStackable: true,
                                duration: 'recurring',
                            },
                        }),
                    ],
                },
            ],
        },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000,
        },
    });

    it('CHANNEL 9 — a Protection redirect currently LOWERS absorbed (pinned, not endorsed)', () => {
        const withAlly = (stacks?: number) => {
            idCounter = 0;
            return simulateDefenseSurvivability(
                BASE({
                    rounds: KEEP.rounds,
                    defender: { ...DEFENDER, defence: KEEP.defence },
                    enemies: [attacker(KEEP.attack)],
                    ...(stacks === undefined ? {} : { teamActors: [protectorAlly(stacks)] }),
                })
            );
        };
        const alone = withAlly();
        const inertAlly = withAlly(0);
        const covered30 = withAlly(3);
        const covered50 = withAlly(5);

        // CONTROL: an ally with ZERO stacks changes nothing, so the movement below is the REDIRECT
        // and not merely "a second ship joined the board".
        expect(inertAlly.damageAbsorbed).toBe(alone.damageAbsorbed);
        // The window is the same in all four runs — no round-count confound.
        expect(alone.survived).toBe(true);
        expect(covered50.survived).toBe(true);
        expect(covered50.elapsedRounds).toBe(alone.elapsedRounds);

        expect(alone.damageAbsorbed).toBe(40_000);
        // The retention fraction, pinned on the RAW axis. Delete
        // `damageRaw = damageRaw * cascade.targetRetainedFraction` and all three collapse to 40,000.
        expect(covered30.damageAbsorbed).toBe(28_000);
        expect(covered50.damageAbsorbed).toBe(20_000);
        // The redirect really fired: less ARRIVED too, in the same proportion.
        expect(covered30.breakdown.gross).toBeLessThan(alone.breakdown.gross);
        expect(covered50.breakdown.gross).toBeLessThan(covered30.breakdown.gross);
    });

    // ── PRESENCE: MIX THE CHANNELS (C5) ───────────────────────────────────────────────────────
    //
    // "Those channels fold no defence today, so they enter at face value — but they must be
    // PRESENT in the total, not silently zero." Each arm ISOLATES one channel (an enemy that deals
    // no direct damage at all), so a non-zero total can only have come from that channel.
    it('PRESENCE: DoT ticks are in the total', () => {
        const r = run({
            rounds: 4,
            attack: 10_000,
            defence: 5_000,
            defenderOverrides: { security: 0 },
            enemyAbilities: [
                ab({
                    type: 'dot',
                    target: 'enemy',
                    config: { type: 'dot', dotType: 'inferno', tier: 45, stacks: 3, duration: 5 },
                }),
            ],
        });
        expect(r.damageAbsorbed).toBe(81_000);
        // WHAT THIS SECOND LINE IS AND IS NOT. On THIS fixture the two axes coincide by
        // construction: a DoT tick folds no defence, and this defender applies no other
        // victim-side reduction either. So the equality CANNOT tell a correct raw booking from the
        // funnel's `?? rawDamage` fallback — both produce it. It is a tripwire on the fixture, not
        // on the booking: if a DoT ever starts folding defence, or this fixture ever grows a
        // reduction, this line goes red and the arm must be re-derived rather than re-blessed.
        // The booking itself is fenced where the axes genuinely diverge — channel 6 above (Vortex
        // Veil on the focus) and `rawIntakeAxis.test.ts` path 8 (the same on an ALLY).
        expect(r.damageAbsorbed).toBe(r.breakdown.gross);
    });

    it('PRESENCE: bomb detonations are in the total', () => {
        const r = run({
            rounds: 6,
            attack: 10_000,
            defence: 5_000,
            defenderOverrides: { security: 0 },
            enemyAbilities: [
                ab({
                    type: 'dot',
                    target: 'enemy',
                    config: { type: 'dot', dotType: 'bomb', tier: 100, stacks: 2, duration: 2 },
                }),
            ],
        });
        expect(r.damageAbsorbed).toBe(80_000);
        // Same standing as the DoT arm's twin above: equality by construction on this fixture, a
        // tripwire on the fixture rather than evidence about the booking. The 80,000 is the
        // presence claim; this line only says the bomb channel met no victim-side reduction here.
        expect(r.damageAbsorbed).toBe(r.breakdown.gross);
    });

    it('PRESENCE: skill detonation adds to the total', () => {
        const basic = () =>
            ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });
        const dot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'inferno', tier: 45, stacks: 3, duration: 5 },
            });
        const opts = {
            rounds: 6,
            attack: 10_000,
            defence: 5_000,
            defenderOverrides: { security: 0 },
        };
        // A DIFFERENTIAL, not a bare non-zero: an inferno DoT is already in both runs, so only the
        // detonation slice can explain the gap. A `> 0` assertion on the second run alone would
        // have been satisfied by the DoT and proved nothing about detonation.
        const noDetonate = run({ ...opts, enemyAbilities: [basic(), dot()] });
        const detonating = run({
            ...opts,
            enemyAbilities: [
                basic(),
                dot(),
                ab({
                    type: 'detonate-dot',
                    target: 'enemy',
                    config: { type: 'detonate-dot', dotType: 'inferno', powerPct: 300 },
                }),
            ],
        });
        expect(detonating.damageAbsorbed).toBeGreaterThan(noDetonate.damageAbsorbed);
        expect(noDetonate.damageAbsorbed).toBe(175_000);
        expect(detonating.damageAbsorbed).toBe(195_500);
    });

    /**
     * The reflect fixture, parameterised by the DEFENDER's own `incoming-reduction` passive.
     *
     * WHY THE PARAMETER IS ON THE DEFENDER AND NOT THE ENEMY. On a reflected hit the roles swap:
     * the focus ship is the ATTACKER of the original swing and therefore the VICTIM of the
     * bounce-back. `damageReflection`'s `reflectVictimIncomingReductionPct` is resolved from
     * `incomingAbilitiesOf(attacker.id)` — the focus ship's own passives. Its old name
     * (`attackerIncomingReductionPct`) made it read as attacker-side and is why this channel stayed
     * inverted; the arm below is the fence that reading can no longer get past.
     */
    const reflectRun = (opts: { incomingReductionPct?: number } = {}) => {
        idCounter = 0;
        const defenderSlots: ShipSkills['slots'] = [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 200, hits: 1 },
                    }),
                ],
            },
        ];
        if (opts.incomingReductionPct) {
            defenderSlots.push({
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'incoming-reduction',
                        target: 'self',
                        config: {
                            type: 'incoming-reduction',
                            scope: 'direct',
                            condition: 'always',
                            pct: opts.incomingReductionPct,
                            critFamily: false,
                        },
                    }),
                ],
            });
        }
        return simulateDefenseSurvivability(
            BASE({
                rounds: 4,
                // The defender must actually SWING for thorns to come back, so unlike every other
                // fixture in this file it carries attack and an offensive active skill.
                defender: { ...DEFENDER, defence: 5_000, attack: 50_000 },
                shipSkills: { slots: defenderSlots },
                enemies: [
                    {
                        // attack 0: the enemy never swings, so every point below is reflect.
                        id: 'e1',
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            speed: 50,
                            hp: 100_000_000,
                            defence: 0,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'passive',
                                    abilities: [
                                        ab({
                                            // Top-level type is a placeholder; the engine keys on
                                            // config.type (see buildEquipmentAbilities REFLECT).
                                            type: 'modifier',
                                            target: 'self',
                                            config: { type: 'damage-reflection', pct: 50 },
                                        }),
                                    ],
                                },
                            ],
                        },
                    },
                ],
            })
        );
    };

    it('PRESENCE: reflected thorns land on the thrown axis PRE-defence', () => {
        const r = reflectRun();
        // 50,000 reflected per round × 4 rounds, thrown; 20,828/round after the defender's own
        // 5,000 defence mitigated it. The two axes being DIFFERENT is the point — reflect is one
        // of the channels that DOES fold the recipient's defence, so booking it post-mitigation
        // would have been invisible on a defence-0 fixture.
        expect(r.damageAbsorbed).toBe(200_000);
        expect(r.breakdown.gross).toBeLessThan(r.damageAbsorbed);
        expect(r.breakdown.gross).toBe(83_312);
    });

    // ── CHANNEL 8: the RECIPIENT's incoming-reduction on the REFLECT channel ───────────────────
    //
    // THE FOURTH INVERSION, and the one a full review waved through because the parameter used to
    // be spelled `attackerIncomingReductionPct` — "attacker" positionally, read as "attacker"
    // causally, so it looked like a term that had no business being stripped. It is now
    // `reflectVictimIncomingReductionPct`. MEASURED before the fix, on exactly this fixture:
    // `0% -> 200,000` · `30% -> 140,000` · `60% -> 80,000`, all three over the same 4 rounds. A
    // purely defensive passive quartered its owner's own headline.
    //
    // The `gross` assertions are the LIVENESS half and are not optional: they are the only thing
    // here that separates "the reduction applied and was correctly excluded from the thrown axis"
    // from "the passive never fired at all", which would also leave `damageAbsorbed` at 200,000.
    it('DIRECTION (channel 8 — reflect, the recipient’s own incoming-reduction): absorbed is FLAT', () => {
        const plain = reflectRun();
        const warded = reflectRun({ incomingReductionPct: 30 });
        const bunker = reflectRun({ incomingReductionPct: 60 });

        // LIVENESS: the passive really is eating the bounce-back — monotonically less ARRIVES.
        expect(warded.breakdown.gross).toBeLessThan(plain.breakdown.gross);
        expect(bunker.breakdown.gross).toBeLessThan(warded.breakdown.gross);
        expect(plain.breakdown.gross).toBe(83_312);
        expect(warded.breakdown.gross).toBe(58_320);
        expect(bunker.breakdown.gross).toBe(33_324);

        // The window is identical in all three runs, so the thrown total must be too: nothing
        // about the defender's own protection changes what the enemy bounced back.
        expect(warded.elapsedRounds).toBe(plain.elapsedRounds);
        expect(bunker.elapsedRounds).toBe(plain.elapsedRounds);

        // DIRECTION: 200,000 thrown, three times over. Re-fold `incoming` into `preMitigation`
        // in `reflectedDamageParts` and these become 140,000 and 80,000.
        expect(plain.damageAbsorbed).toBe(200_000);
        expect(warded.damageAbsorbed).toBe(200_000);
        expect(bunker.damageAbsorbed).toBe(200_000);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #389 — A DEFENDER-APPLIED OUTGOING DEBUFF DOES REDUCE WHAT ITS ATTACKER THROWS
//
// HISTORY, because it explains the shape of this block. #358 task 13 discovered that the engine
// folded an attacker's OWN `Attack Down` / `Out. Damage Down` and silently ignored one applied by
// the DEFENDER — a defender-applied -90% left a 10,000-attack enemy throwing a full 40,000 over
// four rounds. That task did not settle whether it SHOULD, so it pinned the defective behaviour
// with an explicit "delete me if the ruling flips" note and corrected the three text claims that
// promised the opposite.
//
// THE RULING FLIPPED (#389): a debuff reducing an actor's outgoing damage folds into that actor's
// outgoing damage regardless of who applied it. The pin has therefore been DELETED, not loosened,
// and replaced by the direction arm below. The two liveness arms survive because they are still
// exactly the instruments that keep this block honest.
//
// AND A SECOND RULING (#389 spec §5): same-family instances SHADOW across the self/enemy boundary
// — highest tier wins, never the sum. That matters here more than anywhere, because additive is
// precisely what the code does if the dead enemy-side channel is merely switched on. The three
// `§5.3` arms at the bottom of this describe are the guards on that.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('#389 — a DEFENDER-APPLIED outgoing debuff reduces what its attacker throws', () => {
    /**
     * One attacker at 10,000/round and a defender that casts an enemy-side debuff before swinging.
     *
     * ⚠️ THE `duration` IS LOAD-BEARING AND IT IS THE FIXTURE TRAP HERE. Measured: with
     * `duration: 'recurring'` a defender-applied enemy debuff is INERT — the enemy dies on exactly
     * the round it would have with no debuff at all, even when the debuff carries a +200%
     * `incomingDamage` that ought to triple the defender's own damage. A NUMERIC duration lands.
     * The whole sweep this arm replaces was run on `'recurring'` and reported "no movement" for a
     * debuff that had never applied — a vacuous fixture that would have "proved" the same
     * conclusion for the wrong reason. Every debuff below therefore carries a numeric duration
     * covering the whole window, and the liveness arm proves that it lands.
     */
    const suppressRun = (opts: {
        effects: ParsedBuffEffects | null;
        enemyHp: number;
        defAttack: number;
        rounds: number;
    }) => {
        idCounter = 0;
        const swing = ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier: 200, hits: 1 },
        });
        const abilities = opts.effects
            ? [
                  ab({
                      type: 'debuff',
                      target: 'all-enemies',
                      config: {
                          type: 'debuff',
                          buffName: 'Suppression',
                          parsedEffects: opts.effects,
                          stacks: 1,
                          isStackable: false,
                          application: 'apply',
                          duration: 99,
                      },
                  }),
                  swing,
              ]
            : [swing];
        return simulateDefenseSurvivability(
            BASE({
                rounds: opts.rounds,
                defender: { ...DEFENDER, attack: opts.defAttack },
                shipSkills: { slots: [{ slot: 'active', abilities }] },
                enemies: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 10_000,
                            crit: 0,
                            critDamage: 0,
                            speed: 50,
                            hp: opts.enemyHp,
                            defence: 0,
                        },
                        chargeCount: 0,
                        startCharged: false,
                    },
                ],
            })
        );
    };

    /** Unkillable enemy, defender attack 0 → the window is pinned at 4 rounds in every run, so
     *  nothing below can move through the ROUNDS route and confound the reading. */
    const PINNED = { enemyHp: 100_000_000, defAttack: 0, rounds: 4 };

    // ── LIVENESS 1: the outgoing fold IS live, and it IS sign-sensitive ───────────────────────
    //
    // Without this the flat readings below would also hold on an engine that folded no outgoing
    // modifier at all. Same magnitude, same sign, same window — the ONLY difference is who applied
    // it. Note the shape: this one is a SELF-buff on the enemy, not a debuff from the defender.
    it('LIVENESS: the SAME −50% outgoing modifier, self-applied by the enemy, HALVES the headline', () => {
        idCounter = 0;
        const plain = suppressRun({ ...PINNED, effects: null });
        idCounter = 0;
        const selfSuppressed = simulateDefenseSurvivability(
            BASE({
                rounds: 4,
                enemies: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 10_000,
                            crit: 0,
                            critDamage: 0,
                            speed: 50,
                            hp: 100_000_000,
                            defence: 0,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        ab({
                                            type: 'buff',
                                            target: 'self',
                                            config: {
                                                type: 'buff',
                                                buffName: 'Out. Damage Down II',
                                                parsedEffects: { outgoingDamage: -50 },
                                                stacks: 1,
                                                isStackable: false,
                                                duration: 'recurring',
                                            },
                                        }),
                                        ab({
                                            type: 'damage',
                                            target: 'enemy',
                                            config: { type: 'damage', multiplier: 100, hits: 1 },
                                        }),
                                    ],
                                },
                            ],
                        },
                    },
                ],
            })
        );
        expect(plain.damageAbsorbed).toBe(40_000);
        expect(selfSuppressed.damageAbsorbed).toBe(20_000);
        expect(selfSuppressed.elapsedRounds).toBe(plain.elapsedRounds);
    });

    // ── LIVENESS 2: the defender's debuff INSTANCE really lands ──────────────────────────────
    //
    // The one assertion that separates "the engine ignores a defender-applied outgoing debuff"
    // from "this fixture never applied a debuff at all". SAME ability shape, SAME application,
    // SAME numeric duration as the direction arm — only the enemy is killable and the defender
    // swings, so the `incomingDamage` half of the very same instance becomes observable.
    it('LIVENESS: the same debuff instance DOES land — its Inc. Damage Up half is honoured', () => {
        const LIVE = { enemyHp: 200_000, defAttack: 20_000, rounds: 6 };
        const plain = suppressRun({ ...LIVE, effects: null });
        const both = suppressRun({
            ...LIVE,
            effects: { outgoingDamage: -50, incomingDamage: 200 },
        });
        // 40,000/round into 200,000 HP → the enemy dies in round 5 with no debuff…
        expect(plain.elapsedRounds).toBe(5);
        // …and in round 2 with the SAME instance's +200% incoming honoured. The debuff landed.
        expect(both.elapsedRounds).toBe(2);
        // #389: the `outgoingDamage: -50` half of that same landed instance is now honoured too —
        // round 1 falls from a full 10,000 to exactly half. Before #389 both figures read 10,000,
        // and those two assertions were the second of the two pins this issue deleted: they were
        // the sharpest statement of the defect (one instance, both halves landed, only one obeyed).
        expect(plain.rounds[0].incomingDamageRaw).toBe(10_000);
        expect(both.rounds[0].incomingDamageRaw).toBe(5_000);
    });

    // ── THE DIRECTION ARM (replaces the #358 pin) ────────────────────────────────────────────
    //
    // ⚠️ THIS ARM REPLACES A DELETED PIN. #358 task 13 asserted the OPPOSITE here — that the four
    // figures below were all a flat 40,000 — and carried a note saying that if the open ruling ever
    // came back YES this arm should be DELETED, together with the three text claims it fenced, and
    // never loosened. That is what happened: the pin is gone, the sim's module header, the in-app
    // docs and the changelog all moved with it, and this is the arm that took its place.
    //
    // DIRECTION, NOT MAGNITUDE. Every figure is asserted exactly AND the sequence is asserted
    // strictly monotone, because a magnitude-only assertion passes with the sign inverted. The
    // `+50%` row is the sign witness from the other side: the same channel, applied by the same
    // defender, must make the attacker hit HARDER when the modifier is positive.
    it('DIRECTION: more defender-applied suppression means strictly less damage thrown', () => {
        const plain = suppressRun({ ...PINNED, effects: null });
        const out25 = suppressRun({ ...PINNED, effects: { outgoingDamage: -25 } });
        const out50 = suppressRun({ ...PINNED, effects: { outgoingDamage: -50 } });
        const out90 = suppressRun({ ...PINNED, effects: { outgoingDamage: -90 } });
        const atk25 = suppressRun({ ...PINNED, effects: { attack: -25 } });
        const atk50 = suppressRun({ ...PINNED, effects: { attack: -50 } });
        const atk90 = suppressRun({ ...PINNED, effects: { attack: -90 } });
        const amped = suppressRun({ ...PINNED, effects: { outgoingDamage: 50 } });

        // The window really is pinned at 4 rounds in every run, so none of the movement below can
        // be a round-count artefact (the enemy is unkillable and the defender's attack is 0).
        for (const r of [plain, out25, out50, out90, atk25, atk50, atk90, amped]) {
            expect(r.survived).toBe(true);
            expect(r.elapsedRounds).toBe(4);
        }

        // `Out. Damage Down`: the outgoing-multiplier channel.
        expect(plain.damageAbsorbed).toBe(40_000);
        expect(out25.damageAbsorbed).toBe(30_000);
        expect(out50.damageAbsorbed).toBe(20_000);
        expect(out90.damageAbsorbed).toBe(4_000);
        // `Attack Down`: the attack-stat channel. Equal to the outgoing figures here only because
        // this fixture's damage is linear in attack with no flat term — not a general identity.
        expect(atk25.damageAbsorbed).toBe(30_000);
        expect(atk50.damageAbsorbed).toBe(20_000);
        expect(atk90.damageAbsorbed).toBe(4_000);

        // STRICTLY MONOTONE in suppression, both channels. This is the assertion that a
        // sign-inverted implementation cannot satisfy.
        const outSeries = [plain, out25, out50, out90].map((r) => r.damageAbsorbed);
        const atkSeries = [plain, atk25, atk50, atk90].map((r) => r.damageAbsorbed);
        for (const series of [outSeries, atkSeries]) {
            for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThan(series[i - 1]);
        }

        // SIGN WITNESS: the same defender-applied channel with a POSITIVE value raises the figure.
        expect(amped.damageAbsorbed).toBe(60_000);

        // The POST-mitigation axis moves too — this is not a raw-axis-only effect.
        expect(out50.breakdown.gross).toBeLessThan(plain.breakdown.gross);
        expect(atk50.breakdown.gross).toBeLessThan(plain.breakdown.gross);
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════
    // #389 SPEC §5.3 — HIGHEST TIER WINS ACROSS THE SELF/ENEMY BOUNDARY
    //
    // Tier shadowing (`familyApplicationWins`, statusEngine.ts) is PER-STORE: it keys a family map
    // inside ONE side's store and cannot see across the self/enemy boundary. So merely switching on
    // the dead enemy-side channel makes two instances of one named debuff ADD — which the owner
    // ruling rules out. These three arms are the guards on the shadowing layer that prevents it.
    // ══════════════════════════════════════════════════════════════════════════════════════════

    /**
     * A defender that applies named debuffs to an attacker which may ALSO be self-inflicting named
     * debuffs of its own. Distinct from `suppressRun` above in the one way these arms need: the
     * enemy gets its own skill list, so the SELF side of the boundary can be populated.
     *
     * ⚠️ EVERY DURATION IS NUMERIC, AND THAT IS LOAD-BEARING — see `suppressRun`'s note. A
     * `duration: 'recurring'` enemy-side debuff is INERT (the status engine gates the timed enemy
     * write on a numeric duration), and a whole 12-shape sweep during #358 was run that way and
     * reported "no movement" for debuffs that had never landed.
     *
     * Buff NAMES are load-bearing too: `deriveFamilyKey` strips the Roman suffix, so
     * `Attack Down I` and `Attack Down III` are ONE family while `Attack Down III` and
     * `Out. Damage Down III` are TWO. An arm that renamed these would stop testing what it says.
     */
    const boundaryRun = (
        applied: { buffName: string; effects: ParsedBuffEffects }[],
        enemySelf: { buffName: string; effects: ParsedBuffEffects }[]
    ) => {
        idCounter = 0;
        const defenderAbilities = [
            ...applied.map((a) =>
                ab({
                    type: 'debuff',
                    target: 'all-enemies',
                    config: {
                        type: 'debuff',
                        buffName: a.buffName,
                        parsedEffects: a.effects,
                        stacks: 1,
                        isStackable: false,
                        application: 'apply',
                        duration: 99,
                    },
                })
            ),
            ab({
                type: 'damage',
                target: 'enemy',
                config: { type: 'damage', multiplier: 200, hits: 1 },
            }),
        ];
        const enemyAbilities = [
            ...enemySelf.map((a) =>
                ab({
                    type: 'buff',
                    target: 'self',
                    config: {
                        type: 'buff',
                        buffName: a.buffName,
                        parsedEffects: a.effects,
                        stacks: 1,
                        isStackable: false,
                        duration: 99,
                    },
                })
            ),
            ab({
                type: 'damage',
                target: 'enemy',
                config: { type: 'damage', multiplier: 100, hits: 1 },
            }),
        ];
        return simulateDefenseSurvivability(
            BASE({
                rounds: 4,
                defender: { ...DEFENDER, attack: 0 },
                shipSkills: { slots: [{ slot: 'active', abilities: defenderAbilities }] },
                enemies: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 10_000,
                            crit: 0,
                            critDamage: 0,
                            speed: 50,
                            hp: 100_000_000,
                            defence: 0,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: { slots: [{ slot: 'active', abilities: enemyAbilities }] },
                    },
                ],
            })
        );
    };

    /** Real corpus tiers (src/constants/buffs.ts): I = -15%, III = -45%. */
    const AD1 = { buffName: 'Attack Down I', effects: { attack: -15 } as ParsedBuffEffects };
    const AD3 = { buffName: 'Attack Down III', effects: { attack: -45 } as ParsedBuffEffects };
    const OD3 = {
        buffName: 'Out. Damage Down III',
        effects: { outgoingDamage: -45 } as ParsedBuffEffects,
    };
    /** A DIFFERENT family on the SAME channel as `Attack Down` — the only shape that can detect a
     *  collapse across families (see the cross-family arm for why `Out. Damage Down` cannot). */
    const AU2 = { buffName: 'Attack Up II', effects: { attack: 30 } as ParsedBuffEffects };

    it('§5.3 CROSS-STORE SHADOWING: self Attack Down I + applied III yields the III value', () => {
        const plain = boundaryRun([], []);
        const appliedI = boundaryRun([AD1], []);
        const appliedIII = boundaryRun([AD3], []);
        const both = boundaryRun([AD3], [AD1]);

        // THE THREE CANDIDATE FIGURES ARE MUTUALLY DISTINGUISHABLE, asserted before the arm that
        // discriminates between them — without this the arm could not tell shadowing from either
        // alternative it exists to exclude. -15% -> 34,000; -45% -> 22,000; the -60% sum -> 16,000.
        expect(plain.damageAbsorbed).toBe(40_000);
        expect(appliedI.damageAbsorbed).toBe(34_000);
        expect(appliedIII.damageAbsorbed).toBe(22_000);
        const sumFigure = 16_000;
        expect(new Set([34_000, 22_000, sumFigure]).size).toBe(3);

        // THE RULING: the III value, and provably neither of the other two.
        expect(both.damageAbsorbed).toBe(22_000);
        expect(both.damageAbsorbed).not.toBe(34_000); // not the weaker instance
        expect(both.damageAbsorbed).not.toBe(sumFigure); // and NOT additive

        // The window is pinned in every run, so none of this is a round-count artefact.
        for (const r of [plain, appliedI, appliedIII, both]) expect(r.elapsedRounds).toBe(4);
    });

    it('§5.3 CROSS-FAMILY ADDITIVITY: Attack Down and Out. Damage Down still combine', () => {
        // The guard against over-collapsing. `deriveFamilyKey` gives these two DIFFERENT family
        // keys, so shadowing must not touch them — they ride separate channels of the damage
        // formula and compose multiplicatively: 40,000 x 0.55 x 0.55 = 12,100.
        const attackOnly = boundaryRun([AD3], []);
        const outgoingOnly = boundaryRun([OD3], []);
        const bothFamilies = boundaryRun([AD3, OD3], []);

        expect(attackOnly.damageAbsorbed).toBe(22_000);
        expect(outgoingOnly.damageAbsorbed).toBe(22_000);
        expect(bothFamilies.damageAbsorbed).toBe(12_100);

        // Strictly stronger than either alone.
        expect(bothFamilies.damageAbsorbed).toBeLessThan(attackOnly.damageAbsorbed);
        expect(bothFamilies.damageAbsorbed).not.toBe(22_000);

        // ⚠️ THE ASSERTIONS ABOVE ARE NOT ENOUGH ON THEIR OWN, and a mutation check is what
        // proved it: replacing `deriveFamilyKey(b.buffName)` with a single constant key — i.e.
        // collapsing EVERY family into one bucket, the exact defect §5.2 forbids — left all of
        // them GREEN. The reason is structural: `OutgoingFamilyEntry` carries the two channels
        // INDEPENDENTLY, so two families that touch DIFFERENT channels survive a collapse
        // untouched (`strongerPct(-45, 0)` on one channel and `strongerPct(0, -45)` on the other
        // both keep -45). `Attack Down` + `Out. Damage Down` is therefore blind to it.
        //
        // The discriminating case is two different families on the SAME channel, and the corpus
        // has an obvious and realistic one: an `Attack Up` the enemy self-buffs against an
        // `Attack Down` the defender lands. Different families, one channel, so BOTH apply and
        // they net out: +30 - 45 = -15%, i.e. 34,000. Under a collapsed key the two would shadow
        // each other and the stronger (-45) alone would stand, reporting 22,000.
        const selfAmped = boundaryRun([], [AU2]);
        const ampedThenSuppressed = boundaryRun([AD3], [AU2]);
        expect(selfAmped.damageAbsorbed).toBe(52_000); // +30% alone
        expect(ampedThenSuppressed.damageAbsorbed).toBe(34_000); // +30 then -45 => -15%
        expect(ampedThenSuppressed.damageAbsorbed).not.toBe(22_000); // NOT shadowed to the -45
    });

    it('§5.3 REVERSE DIRECTION: a self tier HIGHER than the applied tier wins', () => {
        // Without this arm "highest wins" is untested in the direction where the DEFENDER's debuff
        // is the weaker one — an implementation that simply overwrote the self value with the
        // applied value would pass the cross-store arm above and fail here.
        const selfIIIOnly = boundaryRun([], [AD3]);
        const reverse = boundaryRun([AD1], [AD3]); // self III (-45) vs applied I (-15)

        expect(selfIIIOnly.damageAbsorbed).toBe(22_000);
        expect(reverse.damageAbsorbed).toBe(22_000); // the SELF tier stands
        expect(reverse.damageAbsorbed).not.toBe(34_000); // not overwritten by the weaker applied I
        expect(reverse.damageAbsorbed).not.toBe(16_000); // and still not additive

        // Equal tiers on both sides must also not double.
        expect(boundaryRun([AD3], [AD3]).damageAbsorbed).toBe(22_000);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #358 TASK 13 — THE DEFENDER'S OWN OFFENCE IS A ROUTE BY WHICH THE HEADLINE FALLS
//
// The docs and changelog say "two survivors that both last the FULL window under the same enemies
// tie no matter how differently tanky they are". Both texts already carve out the case where one
// of them ENDS the fight (roster wipe, #329). They did not carve out ATTRITION: killing SOME of
// the attackers thins the volley without ending anything, so two ships can both survive the whole
// window and still report totals 2x apart. This file's own `DEFENDER` fixture has carried
// `attack: 0` with the comment "so the defender cannot kill an enemy and shorten its own window"
// since Task 2 — the behaviour was known and worked around, never asserted.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('#358 task 13 — offence-driven attrition separates two FULL-window survivors', () => {
    /** Two 5,000-attack enemies. `e1` is killable; `e2` is not, so the defender can never wipe the
     *  roster and the run always uses the whole 6-round window — which is what makes this
     *  ATTRITION rather than early termination. */
    const attritionRun = (defAttack: number) => {
        idCounter = 0;
        const enemy = (id: string, hp: number) => ({
            id,
            stats: { attack: 5_000, crit: 0, critDamage: 0, speed: 50, hp, defence: 0 },
            chargeCount: 0,
            startCharged: false,
        });
        return simulateDefenseSurvivability(
            BASE({
                rounds: 6,
                defender: { ...DEFENDER, attack: defAttack },
                shipSkills: skills([
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 200, hits: 1 },
                    }),
                ]),
                enemies: [enemy('e1', 100_000), enemy('e2', 100_000_000)],
            })
        );
    };

    it('a harder-hitting FULL-window survivor is thrown LESS, not more', () => {
        const pacifist = attritionRun(0);
        const middling = attritionRun(20_000);
        const brutal = attritionRun(60_000);

        // LIVENESS, and the whole point: all three survived the FULL window. Without this the
        // chain below would just be re-measuring early termination, which the docs already cover.
        for (const r of [pacifist, middling, brutal]) {
            expect(r.survived).toBe(true);
            expect(r.elapsedRounds).toBe(6);
        }

        // Strictly ordered, so only the DIRECTION satisfies it. 10,000/round while both attackers
        // live, 5,000/round once `e1` is dead — the kill lands earlier the harder the ship hits.
        expect(middling.damageAbsorbed).toBeLessThan(pacifist.damageAbsorbed);
        expect(brutal.damageAbsorbed).toBeLessThan(middling.damageAbsorbed);

        expect(pacifist.damageAbsorbed).toBe(60_000);
        expect(middling.damageAbsorbed).toBe(40_000);
        expect(brutal.damageAbsorbed).toBe(30_000);
    });
});
