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
    // The two EQUALITIES are pinned tripwires for measured inertness, not blessings of it — see the
    // Task 2 report's findings A and B. Both are PRE-EXISTING (a `selfBuffs`-route Defense Up II is
    // inert identically, so neither is an ability-model regression). If either goes red because the
    // engine gained a defensive read, that is the finding being fixed: delete the pin, don't loosen
    // it. NOTE on `isMultiplicative`: a documented NO-OP — set false, never surface it as a toggle.
    it('a self-buff on the incoming-damage channel reduces measured intake; the modifier and defence channels are inert', () => {
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
        // FINDING A: a defender's own Defense Up is inert against incoming damage. The applied
        // per-victim read (`victimDefenseProfileOf`, engine.ts:7229) uses `v.stats.defence` — the
        // BASE stat — so the buffed value never reaches it. Measured with a probe: the cast-level
        // read (`victimDefenceFor`, engine.ts:7919) DID return 6500 on this fixture while the
        // applied damage stayed at the base-5000 value; a defender with base defence 6500 takes
        // 7064/round instead of 8331.
        expect(defenceUp.breakdown.gross).toBe(plain.breakdown.gross);
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
    // FIXTURE CORRECTION (Task 2): the brief gated a 'Defense Up II' (`parsedEffects.defense`)
    // buff. Measured, that buff moves NOTHING on either run (both 24993) — see finding A pinned in
    // the channel test above — so the comparison was zero-vs-zero and could never have proven
    // anything either way. Swapped to the channel that demonstrably reaches the measured number,
    // 'Inc. Damage Down II' (`parsedEffects.incomingDamage`). The test's SHAPE is untouched: same
    // ship, same pressure, same unmet `hp-threshold` gate, same strict inequality.
    it('a conditionally-gated defensive buff does NOT apply while its condition is unmet', () => {
        // Non-zero base defence: keeps this fixture's arithmetic identical to the channel test
        // above, so the two are directly comparable (ungated 17496 / gated 24993 = plain).
        const armoured = { ...DEFENDER, defence: 5_000 };
        const defenseUp = {
            type: 'buff' as const,
            buffName: 'Inc. Damage Down II', // '-30% Incoming Direct Damage' — constants/buffs.ts:311
            parsedEffects: { incomingDamage: -30 },
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

        // The ungated run is genuinely mitigating, or the comparison proves nothing: 5832/round
        // instead of the unmitigated 8331 — not merely non-zero, the mitigated value exactly.
        expect(ungated.breakdown.gross).toBe(17_496);
        // Gate unmet → the buff never applies → each hit lands at full strength → strictly more
        // damage taken, and exactly the no-buff figure.
        expect(gated.breakdown.gross).toBe(24_993);
        expect(gated.breakdown.gross).toBeGreaterThan(ungated.breakdown.gross);
    });
});
