import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability } from '../../../types/abilities';

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
