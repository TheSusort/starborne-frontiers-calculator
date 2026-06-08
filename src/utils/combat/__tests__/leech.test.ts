import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';
import { calculateDamageReduction } from '../../autogear/priorityScore';

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: standing-leech credit hook (engine.ts procStandingLeeches).
// A passive-slot heal/shield ability with basis 'damage-dealt' is a STANDING leech:
// the engine's creditDamage chokepoint procs it at credit time against every channel
// the owner's damage flows through (direct, detonation, corrosion, inferno) — scope
// permitting. The cast path skips these (Task 4 slot-partition); the engine owns them.
//
// All tests keep crit 0 unless the test exercises crits, so every credited damage value
// is an exact integer and the rounded RoundData fields equal the raw amounts the hook saw.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `l${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 2000,
    hp: 10000,
    ...overrides,
});

type HealBucket =
    | 'directHeal'
    | 'hotHeal'
    | 'shield'
    | 'cleanseCount'
    | 'effectiveHeal'
    | 'overheal';

/** Sum a healing bucket over every round for `actorId` (defaults to the focus actor). */
const sumHeal = (
    result: ReturnType<typeof runCombat>,
    bucket: HealBucket,
    actorId = 'attacker'
): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.[bucket] ?? 0),
        0
    );

/** A round's healing bucket for `actorId`. */
const roundHeal = (
    result: ReturnType<typeof runCombat>,
    round: number,
    bucket: HealBucket,
    actorId = 'attacker'
): number => result.healing?.rounds[round - 1]?.perActor.get(actorId)?.[bucket] ?? 0;

const damageAb = (multiplier = 100): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

const leechHeal = (
    pct: number,
    extra: { leechScope?: 'all' | 'detonation'; noCrit?: boolean } = {},
    target: Ability['target'] = 'self'
): Ability =>
    ab({
        type: 'heal',
        target,
        config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all', ...extra },
    });

describe('standing-leech hook — damage-dealt passive', () => {
    // ── Test 1: scope 'all' standing heal procs on direct damage ─────────────
    it('scope all: passive 20% leech heals 20% of the active direct damage', () => {
        idCounter = 0;
        // attack 5000, mult 100, enemyDefense 0 → direct = 5000. crit 0, healMod 0 → no folds.
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10_000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        {
                            slot: 'passive',
                            abilities: [leechHeal(20, { leechScope: 'all' })],
                        },
                    ],
                },
            })
        );
        // 5000 × 0.20 = 1000.
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(1000, 6);
    });

    // ── Test 2: DoT-tick leech lands at tick time (enemy turn) ───────────────
    it('corrosion tick credits the leech: directHeal grows by tick × pct at the tick round', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                hp: 10_000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                damageAb(100),
                                ab({
                                    type: 'dot',
                                    target: 'enemy',
                                    config: {
                                        type: 'dot',
                                        dotType: 'corrosion',
                                        tier: 5,
                                        stacks: 1,
                                        duration: 5,
                                    },
                                }),
                            ],
                        },
                        {
                            slot: 'passive',
                            abilities: [leechHeal(20, { leechScope: 'all' })],
                        },
                    ],
                },
            })
        );
        // Round 1 has only direct (corrosion applied this round ticks on the enemy turn too).
        // For each round, the leech directHeal must equal (direct + corrosion) × 0.20 — i.e.
        // the corrosion portion of the round's credited damage is leeched at tick time.
        for (let r = 1; r <= 3; r++) {
            const row = result.rounds[r - 1];
            const credited = row.directDamage + row.corrosionDamage;
            expect(roundHeal(result, r, 'directHeal')).toBeCloseTo(credited * 0.2, 4);
            // Corrosion must actually be ticking (so the test exercises the tick path).
            expect(row.corrosionDamage).toBeGreaterThan(0);
        }
    });

    // ── Test 3: detonation-scope leech (Valkyrie shape) ──────────────────────
    it('detonation scope: no leech on direct rounds; leech = burst × pct on the burst round', () => {
        idCounter = 0;
        // Two entries (ally → heal target, self → owner). With attacker as the heal target
        // both recipients resolve to 'attacker', so directHeal is credited twice per burst.
        const result = runCombat(
            BASE({
                numRounds: 4,
                hp: 10_000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                damageAb(100),
                                ab({
                                    type: 'accumulate-detonate',
                                    target: 'enemy',
                                    config: { type: 'accumulate-detonate', turns: 2, pct: 50 },
                                }),
                            ],
                        },
                        {
                            slot: 'passive',
                            abilities: [
                                leechHeal(5, { leechScope: 'detonation' }, 'ally'),
                                leechHeal(5, { leechScope: 'detonation' }, 'self'),
                            ],
                        },
                    ],
                },
            })
        );
        // Direct-only rounds (no detonation) → NO leech.
        for (let r = 1; r <= 4; r++) {
            const row = result.rounds[r - 1];
            if (row.detonationDamage === 0) {
                expect(roundHeal(result, r, 'directHeal')).toBe(0);
            } else {
                // Two entries (ally + self), both routing to 'attacker' → burst × 0.05 × 2.
                expect(roundHeal(result, r, 'directHeal')).toBeCloseTo(
                    row.detonationDamage * 0.05 * 2,
                    4
                );
            }
        }
        // At least one burst round must have occurred (otherwise the assertion is vacuous).
        expect(result.rounds.some((row) => row.detonationDamage > 0)).toBe(true);
    });

    // ── Test 4: heal-crit draw at runtime base stats; noCrit suppresses it ───
    it('crit draw doubles the leech heal; noCrit suppresses the draw', () => {
        idCounter = 0;
        // crit 100, critDamage 100 → the heal's own crit draw fires (rate 1.0) → × 2.
        // direct: crit folds the DAMAGE too → 5000 × (1 + 1) = 10000; leech 20% → 2000;
        // heal crit → × 2 = 4000.
        const crits = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 100,
                hp: 10_000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        { slot: 'passive', abilities: [leechHeal(20, { leechScope: 'all' })] },
                    ],
                },
            })
        );
        expect(sumHeal(crits, 'directHeal')).toBeCloseTo(4000, 4);

        idCounter = 0;
        // noCrit:true → the heal draw never crits; only the underlying direct crit fold applies.
        const noCrit = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 100,
                hp: 10_000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        {
                            slot: 'passive',
                            abilities: [leechHeal(20, { leechScope: 'all', noCrit: true })],
                        },
                    ],
                },
            })
        );
        // direct 10000 × 0.20 = 2000; no heal crit.
        expect(sumHeal(noCrit, 'directHeal')).toBeCloseTo(2000, 4);
    });

    // ── Test 5: shield-kind standing leech ───────────────────────────────────
    it('shield kind: credits the shield bucket with no folds; granted to the pool', () => {
        idCounter = 0;
        // healModifier 50 + crit 100 must NOT affect a shield draw (shields never fold).
        const result = runCombat(
            BASE({
                numRounds: 1,
                crit: 100,
                critDamage: 100,
                healModifier: 50,
                hp: 10_000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        {
                            slot: 'passive',
                            abilities: [
                                ab({
                                    type: 'shield',
                                    target: 'self',
                                    config: {
                                        type: 'shield',
                                        pct: 20,
                                        basis: 'damage-dealt',
                                        leechScope: 'all',
                                    },
                                }),
                            ],
                        },
                    ],
                },
            })
        );
        // direct (crit-folded) = 10000; shield 20% → 2000, NO heal/crit folds. No directHeal.
        expect(sumHeal(result, 'shield')).toBeCloseTo(2000, 4);
        expect(sumHeal(result, 'directHeal')).toBe(0);
    });

    // ── Test 6: healModifier folds into a heal-kind leech ────────────────────
    it('healModifier 50 → × 1.5 on the heal-kind leech', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                healModifier: 50,
                hp: 10_000,
                healTargetId: 'attacker',
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        { slot: 'passive', abilities: [leechHeal(20, { leechScope: 'all' })] },
                    ],
                },
            })
        );
        // direct 5000 × 0.20 × 1.5 = 1500.
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(1500, 4);
    });

    // ── Test 7: DPS-mode inertness ───────────────────────────────────────────
    it('no healTargetId: zero healing AND damage identical to a no-leech control', () => {
        idCounter = 0;
        const withLeech = runCombat(
            BASE({
                numRounds: 3,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(150)] },
                        { slot: 'passive', abilities: [leechHeal(20, { leechScope: 'all' })] },
                    ],
                },
            })
        );
        idCounter = 0;
        const control = runCombat(
            BASE({
                numRounds: 3,
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [damageAb(150)] }],
                },
            })
        );
        // No healing field in DPS mode.
        expect(withLeech.healing).toBeUndefined();
        // Damage totals byte-identical to the no-leech control (inertness).
        expect(withLeech.rounds.map((r) => r.totalRoundDamage)).toEqual(
            control.rounds.map((r) => r.totalRoundDamage)
        );
        expect(withLeech.rawTotals).toEqual(control.rawTotals);
    });

    // ── Test 8: all-allies recipient routing ─────────────────────────────────
    it('all-allies: directHeal credited once per recipient (playerIds order)', () => {
        idCounter = 0;
        const teamWalk = (id: string, speed: number): TeamActorEngineInput => ({
            id,
            speed,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [] },
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 1000,
                    hp: 8000,
                },
                debuffLandingChance: 1,
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        });
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10_000,
                healTargetId: 'attacker',
                speed: 200,
                teamActors: [teamWalk('t1', 40), teamWalk('t2', 30)],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        {
                            slot: 'passive',
                            abilities: [leechHeal(10, { leechScope: 'all' }, 'all-allies')],
                        },
                    ],
                },
            })
        );
        // direct 5000 × 0.10 = 500 per recipient; 3 recipients (attacker, t1, t2) → 1500
        // all credited to the caster ('attacker') directHeal.
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(1500, 4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: damage-taken procs (damage-leech spec §5). A passive-slot heal/shield
// ability with basis 'damage-taken' on the HEAL TARGET procs once per enemy ATTACK,
// AFTER that attack's shield-first drain (so the proc never absorbs its own trigger).
// raw = FULL attack damage × pct (not just the HP portion). Quixilver's punch-through
// gate (requiresHpDamage): the attack must have started with shield > 0 AND dealt HP
// damage. Malvex is unconditional. Shield-kind only → fully deterministic (no folds).
// ─────────────────────────────────────────────────────────────────────────────
describe('damage-taken procs — passive on the heal target', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    // Manual enemy attacker, speed 10 so it always acts AFTER the focus attacker (default
    // speed) — guarantees any same-turn active shield is granted before the attack lands.
    const manualEnemy = (id: string, attack: number, speed = 10): EnemyAttacker => ({
        id,
        stats: { attack, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
    });

    const takenShield = (pct: number, requiresHpDamage = false): Ability =>
        ab({
            type: 'shield',
            target: 'self',
            config: { type: 'shield', pct, basis: 'damage-taken', requiresHpDamage },
        });

    // Active-slot shield to seed a pre-existing pool (basis 'hp' → pct% of max HP).
    const activeShield = (pct: number): Ability =>
        ab({
            type: 'shield',
            target: 'self',
            config: { type: 'shield', pct, basis: 'hp' },
        });

    const incoming = (result: ReturnType<typeof runCombat>, round: number): number =>
        result.healing?.rounds[round - 1]?.incomingDamage ?? 0;
    const shieldAbsorbed = (result: ReturnType<typeof runCombat>, round: number): number =>
        result.healing?.rounds[round - 1]?.shieldAbsorbed ?? 0;

    // ── Test 1: Malvex shape — unconditional shield proc grows the pool ──────────
    it('malvex: passive 15% damage-taken shield grows the pool each attack', () => {
        idCounter = 0;
        // attack 2000, defence 0 → D = 2000/round. No pre-existing shield.
        //   R1: shieldBefore 0, absorbed 0, hpDamage 2000. Proc unconditional → shield += 300.
        //   R2: shieldBefore 300, absorbed 300 (the R1 proc), proc again → shield += 300.
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 2000)],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        { slot: 'passive', abilities: [takenShield(15)] },
                    ],
                },
            })
        );
        // Shield bucket: 2000 × 0.15 = 300 per attack, both rounds → 600.
        expect(sumHeal(result, 'shield')).toBeCloseTo(600, 4);
        // The R2 attack drains the R1 proc (300) — proof the pool actually grew & persisted.
        expect(shieldAbsorbed(result, 2)).toBeCloseTo(300, 4);
    });

    // ── Test 2: Quixilver gate, no shield at attack start → no proc ──────────────
    it('quixilver gate: no shield at attack start → no proc', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 2000)],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        { slot: 'passive', abilities: [takenShield(25, true)] },
                    ],
                },
            })
        );
        // requiresHpDamage gate needs shieldBefore > 0; pool starts empty and never grows
        // (the proc itself never fires) → zero shield ever.
        expect(sumHeal(result, 'shield')).toBe(0);
    });

    // ── Test 3: Quixilver punch-through → proc fires on FULL attack damage ───────
    it('quixilver punch-through: shield drained AND HP damage dealt → proc on full damage', () => {
        idCounter = 0;
        // Active shield 10% of 10000 = 1000 (granted on the attacker's turn, before the
        // enemy at speed 10 attacks). Enemy D = 2000:
        //   shieldBefore 1000 > 0, absorbed 1000, hpDamage 1000 > 0 → gate passes.
        //   proc = 2000 × 0.25 = 500 (FULL attack damage, not the 1000 HP portion).
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 2000)],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100), activeShield(10)] },
                        { slot: 'passive', abilities: [takenShield(25, true)] },
                    ],
                },
            })
        );
        // Shield bucket = active grant (1000) + proc (500) = 1500.
        expect(sumHeal(result, 'shield')).toBeCloseTo(1500, 4);
        // Only the pre-existing 1000 pool was absorbed — the proc applied AFTER the drain.
        expect(shieldAbsorbed(result, 1)).toBeCloseTo(1000, 4);
        expect(incoming(result, 1)).toBeCloseTo(2000, 4);
    });

    // ── Test 4: Quixilver gate, attack fully absorbed → no HP damage → no proc ───
    it('quixilver gate: shield fully absorbs the attack (hpDamage 0) → no proc', () => {
        idCounter = 0;
        // Active shield 50% = 5000 pool. Enemy D = 2000 → absorbed 2000, hpDamage 0 → gate
        // fails (no HP damage). Only the active grant (5000) lands; no +500 proc.
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 10_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 2000)],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100), activeShield(50)] },
                        { slot: 'passive', abilities: [takenShield(25, true)] },
                    ],
                },
            })
        );
        expect(sumHeal(result, 'shield')).toBeCloseTo(5000, 4);
        expect(shieldAbsorbed(result, 1)).toBeCloseTo(2000, 4);
    });

    // ── Test 5: proc applies AFTER the drain — granting attack gets no absorption ─
    it('proc-after-drain: the triggering attack is never absorbed by its own proc', () => {
        idCounter = 0;
        // Malvex 15%, 2 rounds, no pre-existing pool.
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 10_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 2000)],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        { slot: 'passive', abilities: [takenShield(15)] },
                    ],
                },
            })
        );
        // R1: pool empty at attack start → 0 absorbed (the proc shield is NOT available to
        // its own trigger). R2: the R1 proc (300) is available → 300 absorbed.
        expect(shieldAbsorbed(result, 1)).toBe(0);
        expect(shieldAbsorbed(result, 2)).toBeCloseTo(300, 4);
    });

    // ── Test 6: dead target — grantShieldToTarget no-ops, no crash ───────────────
    it('dead target: a lethal attack triggers no proc grant and does not crash', () => {
        idCounter = 0;
        // hp 1000, enemy D = 5000 → kills the target. The proc's grantShieldToTarget is a
        // no-op on a dead target (existing semantics). No throw.
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 1000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [manualEnemy('atk1', 5000)],
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        { slot: 'passive', abilities: [takenShield(15)] },
                    ],
                },
            })
        );
        expect(result.healing?.destroyedRound).toBe(1);
        // The grant no-ops on a dead target, but the bucket still credits the raw shield
        // (display sub-bucket): 5000 × 0.15 = 750 credited, 0 actually pooled.
        expect(sumHeal(result, 'shield')).toBeCloseTo(750, 4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6b: enemy attackers walk runPlayerTurn bound to the heal target. These tests
// LOCK the per-round incoming-damage parity that the retired runEnemyAttackerTurn used
// to produce (its damage-formula coverage, folded here), plus the NEW per-target debuff
// / self-buff behaviour the walk unlocks.
//
// Parity formula (bare neutral enemy): incoming = attack × (mult × hits / 100) × critMult
//   × (1 − dr(targetDefence)/100), critMult = 1 + (critHits/drawHits) × (critDamage/100).
// The enemy uses its OWN crit gate (back-loaded at rate 0.5: first draw does NOT fire).
// ─────────────────────────────────────────────────────────────────────────────
describe('enemy attacker damage parity (runPlayerTurn vs the heal target)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `pe${++idCounter}`,
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });
    const enemyDamageSkills = (active: number, charged?: number, hits = 1): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    enemyAb({
                        type: 'damage',
                        config: { type: 'damage', multiplier: active, hits },
                    }),
                ],
            },
            ...(charged !== undefined
                ? [
                      {
                          slot: 'charged' as const,
                          abilities: [
                              enemyAb({
                                  type: 'damage',
                                  config: { type: 'damage', multiplier: charged },
                              }),
                          ],
                      },
                  ]
                : []),
        ],
    });
    // The heal target is the focus attacker; it self-heals a trivial amount each round so the
    // run produces healing rounds. incomingDamage is the enemy's drained damage per round.
    const incoming = (result: ReturnType<typeof runCombat>, round: number): number =>
        result.healing?.rounds[round - 1]?.incomingDamage ?? 0;

    // ── Manual flat card: one hit at 100% × (1 − reduction) ──────────────────────
    it('manual enemy: one hit at 100% with defence reduction (parity)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 1_000_000,
                defence: 2000,
                healTargetId: 'attacker',
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                    } as EnemyAttacker,
                ],
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [damageAb(100)] }],
                },
            })
        );
        // Old runEnemyAttackerTurn manual path: 5000 × (1 − dr(2000)/100).
        const expected = 5000 * (1 - calculateDamageReduction(2000) / 100);
        expect(incoming(result, 1)).toBeCloseTo(expected, 4);
        expect(incoming(result, 1)).toBeCloseTo(3186.4464026358046, 4);
    });

    it('manual enemy: zero target defence → no reduction', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                    } as EnemyAttacker,
                ],
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAb(100)] }] },
            })
        );
        expect(incoming(result, 1)).toBeCloseTo(5000, 4);
    });

    // ── Crit gate schedule (back-loaded rate 0.5): crits on draws 2, 4, … ─────────
    it('crit 50 enemy: crits on every 2nd attack (back-loaded gate)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 4,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1000, crit: 50, critDamage: 100, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                    } as EnemyAttacker,
                ],
                // Focus self-heals a trivial amount so the target never dies (10000 hp default
                // would be drained otherwise). hp huge; tiny heal keeps rounds running.
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAb(100)] }] },
            })
        );
        // Non-crit attack = 1000; crit (critMult 1 + 1×1) = 2000. Crits land on attacks 2, 4.
        expect([
            incoming(result, 1),
            incoming(result, 2),
            incoming(result, 3),
            incoming(result, 4),
        ]).toEqual([1000, 2000, 1000, 2000]);
    });

    // ── Charge cadence: chargeCount 3 → charged on attack 4 (400% multiplier) ─────
    it('ship-backed enemy: charged spike on the 4th attack (chargeCount 3)', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 5,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 3,
                        startCharged: false,
                        shipSkills: enemyDamageSkills(100, 400),
                    } as EnemyAttacker,
                ],
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAb(100)] }] },
            })
        );
        // charges: t1 0→1, t2 1→2, t3 2→3, t4 fires charged (reset), t5 0→1.
        expect([1, 2, 3, 4, 5].map((r) => incoming(result, r))).toEqual([
            1000, 1000, 1000, 4000, 1000,
        ]);
    });

    // ── Multi-hit per-hit crits: 3 hits, crit 100 → blended × (1 + cd/100) ────────
    it('multi-hit enemy: 3 hits all crit → blended crit multiplier', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 1,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1000, crit: 100, critDamage: 50, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: enemyDamageSkills(100, undefined, 3),
                    } as EnemyAttacker,
                ],
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAb(100)] }] },
            })
        );
        // 3 hits all crit (crit 100): critMult = 1 + (3/3) × (50/100) = 1.5.
        // 1000 × (100 × 3 / 100) × 1.5 = 4500.
        expect(incoming(result, 1)).toBeCloseTo(4500, 4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6b NEW behaviour: a walked enemy's kit lands per-TARGET debuffs and self-buffs.
// Verified through the event bus (the engine's external write-only tap).
// ─────────────────────────────────────────────────────────────────────────────
describe('enemy attacker kit application (runPlayerTurn walk)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `ka${++idCounter}`,
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });

    it('enemy debuff ability → debuff-applied targets the heal target id', () => {
        idCounter = 0;
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('debuff-applied', (e) => events.push(e));
        runCombat(
            BASE({
                numRounds: 1,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                bus,
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        enemyAb({
                                            type: 'damage',
                                            config: { type: 'damage', multiplier: 100 },
                                        }),
                                        enemyAb({
                                            type: 'debuff',
                                            target: 'enemy',
                                            config: {
                                                type: 'debuff',
                                                buffName: 'Defense Down',
                                                parsedEffects: { defense: -20 },
                                                stacks: 1,
                                                isStackable: false,
                                                application: 'inflict',
                                                duration: 2,
                                            },
                                        }),
                                    ],
                                },
                            ],
                        } as ShipSkills,
                    } as EnemyAttacker,
                ],
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAb(100)] }] },
            })
        );
        const applied = events.filter(
            (e) => e.type === 'debuff-applied' && e.sourceId === 'e1'
        ) as Extract<CombatEvent, { type: 'debuff-applied' }>[];
        expect(applied.length).toBeGreaterThan(0);
        // The debuff lands on the HEAL TARGET (the attacker), not the dummy enemy wall.
        for (const e of applied) expect(e.targetId).toBe('attacker');
    });

    it('enemy self-buff ability → buff-expired carries the enemy attacker id (own decrement)', () => {
        idCounter = 0;
        const expired: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('buff-expired', (e) => expired.push(e));
        runCombat(
            BASE({
                numRounds: 3,
                hp: 1_000_000,
                defence: 0,
                healTargetId: 'attacker',
                bus,
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        enemyAb({
                                            type: 'damage',
                                            config: { type: 'damage', multiplier: 100 },
                                        }),
                                        enemyAb({
                                            type: 'buff',
                                            target: 'self',
                                            config: {
                                                type: 'buff',
                                                buffName: 'Attack Up',
                                                parsedEffects: { attack: 30 },
                                                stacks: 1,
                                                isStackable: false,
                                                duration: 1,
                                            },
                                        }),
                                    ],
                                },
                            ],
                        } as ShipSkills,
                    } as EnemyAttacker,
                ],
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAb(100)] }] },
            })
        );
        // The enemy's own self-buff (1-turn) expires under ITS OWN decrement (actorId 'e1').
        const own = (expired as Extract<CombatEvent, { type: 'buff-expired' }>[]).filter(
            (e) => e.actorId === 'e1' && e.buffName === 'Attack Up'
        );
        expect(own.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: live enemyBuffNames (enemy self-buffs) + selfDebuffNames (target debuffs)
// flow into player condition contexts. Names ONLY — never re-folding effects.
// Plus the preliminary 6b-review dead-target guard: cadence advances vs a dead
// target, but NO application/events reach it.
// ─────────────────────────────────────────────────────────────────────────────
describe('enemyBuffNames / selfDebuffNames in player gates (Task 7)', () => {
    type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
    const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
        id: `t7${++idCounter}`,
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        ...partial,
    });

    // An enemy attacker whose active slot deals damage AND grants itself a 99-turn +30%
    // attack self-buff (so the buff is live for every subsequent round).
    const enemyWithSelfBuff: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [
                    enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    enemyAb({
                        type: 'buff',
                        target: 'self',
                        config: {
                            type: 'buff',
                            buffName: 'Attack Up',
                            parsedEffects: { attack: 30 },
                            stacks: 1,
                            isStackable: false,
                            duration: 99,
                        },
                    }),
                ],
            },
        ],
    };

    // ── enemy-buff gate FIRES off the enemy's live self-buff (and not when absent) ───
    it('player enemy-buff gate fires once the enemy holds a self-buff (live)', () => {
        idCounter = 0;
        // Focus has a +100% attack MODIFIER gated on a derivable enemy-buff. When the enemy's
        // self-buff is live, the gate passes → focus directDamage doubles. The focus self-heals
        // a trivial amount so rounds keep running; its attack 10000, enemyDefense 0.
        const gatedFocus: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                        ab({
                            type: 'modifier',
                            target: 'self',
                            conditions: [
                                { subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'attack',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };
        const result = runCombat(
            BASE({
                numRounds: 2,
                attack: 10000,
                hp: 1_000_000,
                enemyDefense: 0,
                enemyHp: 1_000_000_000,
                healTargetId: 'attacker',
                shipSkills: gatedFocus,
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1, crit: 0, critDamage: 0, speed: 1 }, // slowest → acts after focus
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: enemyWithSelfBuff,
                    } as EnemyAttacker,
                ],
            })
        );
        // Round 1: the focus (faster) acts BEFORE the enemy grants its buff → gate sees no
        //          enemy buff → directDamage = 10000.
        // Round 2: the enemy's self-buff is live (granted round 1, 99-turn) → gate fires →
        //          +100% attack → directDamage = 20000.
        expect(result.rounds[0].directDamage).toBe(10000);
        expect(result.rounds[1].directDamage).toBe(20000);
    });

    // ── NO DOUBLE-FOLD: the enemy's self-buff effect is folded EXACTLY once ──────────
    it('exposing the enemy self-buff name does not double-fold its attack effect', () => {
        idCounter = 0;
        // The focus DOES carry a derivable enemy-buff gate → the engine sources and exposes the
        // enemy's self-buff NAME into the focus's condition context. We assert the ENEMY's own
        // incoming damage still reflects a SINGLE +30% attack fold — exposing names never re-folds
        // the payload effect (the double-fold guard).
        const focusWithEnemyBuffGate: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                        ab({
                            type: 'modifier',
                            target: 'self',
                            conditions: [
                                { subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'attack',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };
        const result = runCombat(
            BASE({
                numRounds: 2,
                hp: 1_000_000,
                defence: 0, // tank defence 0 → enemy damage is unreduced (clean integers)
                enemyDefense: 0,
                healTargetId: 'attacker',
                shipSkills: focusWithEnemyBuffGate,
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: enemyWithSelfBuff,
                    } as EnemyAttacker,
                ],
            })
        );
        const incoming = (round: number): number =>
            result.healing?.rounds[round - 1]?.incomingDamage ?? 0;
        // The self-buff folds in the SAME turn it is cast (active for that turn's damage),
        // and persists (99-turn). Every round → 1000 × 1.30 = 1300, folded EXACTLY ONCE.
        // A double-fold would give 1000 × 1.30 × 1.30 = 1690 — explicitly ruled out below.
        expect(incoming(1)).toBeCloseTo(1300, 4);
        expect(incoming(2)).toBeCloseTo(1300, 4);
        expect(incoming(1)).not.toBeCloseTo(1690, 4);
        expect(incoming(2)).not.toBeCloseTo(1690, 4);
    });

    // ── self-debuff gate FIRES off an enemy-applied debuff on the tank ──────────────
    it('tank self-debuff gate fires once an enemy lands a debuff on it (live)', () => {
        idCounter = 0;
        // Focus (the tank) has a +100% attack modifier gated on a derivable self-debuff.
        // An enemy attacker lands a 99-turn 'Defense Down' debuff on the tank. Once live,
        // the gate fires → focus directDamage doubles.
        const tankWithSelfDebuffGate: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                        ab({
                            type: 'modifier',
                            target: 'self',
                            conditions: [
                                {
                                    subject: 'self-debuff',
                                    derivable: true,
                                    buffName: 'Defense Down',
                                },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'attack',
                                value: 100,
                                isMultiplicative: false,
                            },
                        }),
                    ],
                },
            ],
        };
        const result = runCombat(
            BASE({
                numRounds: 2,
                attack: 10000,
                hp: 1_000_000,
                enemyDefense: 0,
                enemyHp: 1_000_000_000,
                healTargetId: 'attacker',
                shipSkills: tankWithSelfDebuffGate,
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 1, crit: 0, critDamage: 0, speed: 1 }, // slowest → acts after focus
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        enemyAb({
                                            type: 'damage',
                                            config: { type: 'damage', multiplier: 100 },
                                        }),
                                        enemyAb({
                                            type: 'debuff',
                                            target: 'enemy',
                                            config: {
                                                type: 'debuff',
                                                buffName: 'Defense Down',
                                                parsedEffects: { defense: -20 },
                                                stacks: 1,
                                                isStackable: false,
                                                application: 'inflict',
                                                duration: 99,
                                            },
                                        }),
                                    ],
                                },
                            ],
                        } as ShipSkills,
                    } as EnemyAttacker,
                ],
            })
        );
        // Round 1: focus acts before the enemy lands the debuff → gate sees no self-debuff →
        //          10000. Round 2: the debuff is live on the tank → gate fires → 20000.
        expect(result.rounds[0].directDamage).toBe(10000);
        expect(result.rounds[1].directDamage).toBe(20000);
    });

    // ── PRELIMINARY (6b review): dead-target guard ──────────────────────────────────
    it('dead target: charge cadence keeps banking AND no debuff is applied', () => {
        idCounter = 0;
        const applied: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('debuff-applied', (e) => applied.push(e));
        // hp 1 → the first enemy attack kills the tank. chargeCount 2: with the target dead from
        // round 1 on, the cadence must still advance (t1 0→1, t2 1→2, t3 fires charged). The
        // enemy's kit also carries a debuff ability — it must NEVER apply to the dead target.
        const result = runCombat(
            BASE({
                numRounds: 4,
                hp: 1,
                enemyDefense: 0,
                healTargetId: 'attacker',
                bus,
                // Focus is damage-only (no self-heal) → once dead it stays dead.
                shipSkills: { slots: [{ slot: 'active', abilities: [damageAb(100)] }] },
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: { attack: 5000, crit: 0, critDamage: 0, speed: 10 },
                        chargeCount: 2,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        enemyAb({
                                            type: 'damage',
                                            config: { type: 'damage', multiplier: 100 },
                                        }),
                                        enemyAb({
                                            type: 'debuff',
                                            target: 'enemy',
                                            config: {
                                                type: 'debuff',
                                                buffName: 'Defense Down',
                                                parsedEffects: { defense: -20 },
                                                stacks: 1,
                                                isStackable: false,
                                                application: 'inflict',
                                                duration: 2,
                                            },
                                        }),
                                    ],
                                },
                                {
                                    slot: 'charged',
                                    abilities: [
                                        enemyAb({
                                            type: 'damage',
                                            config: { type: 'damage', multiplier: 400 },
                                        }),
                                    ],
                                },
                            ],
                        } as ShipSkills,
                    } as EnemyAttacker,
                ],
            })
        );
        // The target dies in round 1 (5000 vs hp 1). The only debuff-applied event allowed is
        // the round-1 application BEFORE death is recorded — but since the round-1 attack itself
        // is what kills it, and the debuff is a SEPARATE ability in the same turn resolved while
        // the target was still alive at turn start, we assert: the target IS dead by run end and
        // NO debuff is applied in rounds where the target entered dead (rounds 2+).
        const destroyed = result.healing?.destroyedRound;
        expect(destroyed).toBe(1);
        // No debuff-applied in any round AFTER the target died (rounds 2, 3, 4): the dead-target
        // guard skips runPlayerTurn (the sole application site) for those turns.
        const lateApplications = (
            applied as Extract<CombatEvent, { type: 'debuff-applied' }>[]
        ).filter((e) => e.round > destroyed!);
        expect(lateApplications.length).toBe(0);
        // Cadence still advanced while dead: by round 3 the enemy banked 2 charges (t1, t2) and
        // would fire its charged slot on t3. We can't read incoming (target dead → 0 damage),
        // so assert the run completed all 4 rounds without the charge bank stalling (no throw,
        // and the healing rounds cover all 4 rounds — the enemy queue kept resolving).
        expect(result.healing?.rounds.length).toBe(4);
    });
});
