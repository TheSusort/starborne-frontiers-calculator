/**
 * Tank-side `hp-changed` emission tests (Phase 4c PR 3, Task 2).
 *
 * The engine emits a tank-side `hp-changed` event ONCE per HP-intake event inside
 * `applyIncomingToTarget`, which is called at TWO sites: per enemy ATTACK (aggregate
 * shield-first drain) AND per tank turn-start DoT-tick batch. The emission covers
 * both deliberately — in-game "when HP drops below N%" includes DoT damage. The
 * event carries EXACT (non-integer) percentages and is emitted AFTER the Cheat-Death
 * intercept (a 100→1-HP save counts as a downward crossing). A killed tank emits
 * ship-destroyed, never a posthumous hp-changed. No consumers yet (Task 3 adds the
 * listener) — these tests assert emission shape only.
 *
 * Mirrors the healing-mode harness in engine.events.test.ts (Phase 4c Task 3): a
 * focus attacker that IS the heal target, ship-/manual-backed enemy attackers, and
 * event collection off the bus.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `hc${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A manual flat enemy: one synthesized basic attack, no skills. */
const manualEnemy = (
    id: string,
    attack: number,
    speed = 50,
    extra: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
    ...extra,
});

/** A no-payload, always-active Cheat Death self-buff (surfaces in the snapshot as recurring). */
const cheatDeathBuff = () => ({
    id: 'cheat-death',
    buffName: 'Cheat Death',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

/**
 * Base healing-mode input: the focus attacker IS the heal target. It does nothing
 * damaging (empty skills) so the only HP-intake is the enemy attacks / DoT ticks.
 */
const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 2,
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
    defence: 0, // no reduction → intake = raw enemy attack
    hp: 10_000,
    healTargetId: 'attacker',
    ...overrides,
});

/** Collect both hp-changed and attacked events off a healing-mode run. */
const collect = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
    const attacked: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('hp-changed', (e) => hpChanged.push(e));
    bus.on('attacked', (e) => attacked.push(e));
    const result = runCombat({ ...input, bus });
    return { hpChanged, attacked, result };
};

describe('Phase 4c PR 3 Task 2 — tank-side hp-changed emission', () => {
    // ── Test 1: one hp-changed per enemy ATTACK (aggregate, even for a 3-hit ability) ──
    // A ship-backed enemy fires a 3-hit damage ability. The drain is aggregate (one
    // applyIncomingToTarget per attack) → exactly ONE tank-side hp-changed per round,
    // even though 3 `attacked` events fire (one per hit). targetId = the heal target.
    // attack 1000, defence 0, multiplier 100, 3 hits, no crit → total damage 3000
    // → newPct = 100 * (10000 - 3000) / 10000 = 70.0 exact.
    it('emits ONE hp-changed per enemy attack (aggregate), with 3 attacked events for a 3-hit ability', () => {
        const threeHitEnemy: EnemyAttacker = {
            id: 'atk1',
            stats: { attack: 1000, crit: 0, critDamage: 0, speed: 50 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            // 3 hits × (attack 1000 × multiplier 100%) = 3000 total damage.
                            // defence 0, no crit → each hit is exactly 1000, aggregate = 3000.
                            ab({
                                type: 'damage',
                                config: { type: 'damage', multiplier: 100, hits: 3 },
                            }),
                        ],
                    },
                ],
            },
        };

        const { hpChanged, attacked } = collect(
            healBase({
                numRounds: 1,
                hp: 10_000,
                enemyAttackers: [threeHitEnemy],
            })
        );

        // Exactly ONE hp-changed (aggregate per attack), but THREE attacked events.
        expect(hpChanged).toHaveLength(1);
        expect(attacked).toHaveLength(3);

        const e = hpChanged[0];
        expect(e.targetId).toBe('attacker');
        expect(e.round).toBe(1);
        // oldPct is exactly 100 (full HP before the attack).
        expect(e.oldPct).toBeCloseTo(100, 6);
        // newPct = 100 * (10000 - 3000) / 10000 = 70.0 exactly (attack 1000, multiplier 100,
        // 3 hits, defence 0, no crit → each hit 1000, aggregate 3000).
        expect(e.newPct).toBeCloseTo(70, 6);
    });

    // ── Test 1b: exact percentages on a manual flat enemy ────────────────────────
    // A manual flat enemy deals a single clean 2500 hit against 10000 max HP and 0
    // defence → exactly 100 → 75. One attack → one hp-changed, one attacked.
    it('carries exact (non-integer-rounded) percentages: 10000 max HP, 2500 damage → 100 → 75', () => {
        const { hpChanged, attacked } = collect(
            healBase({
                numRounds: 1,
                hp: 10_000,
                enemyAttackers: [manualEnemy('atk1', 2500)],
            })
        );
        expect(hpChanged).toHaveLength(1);
        expect(attacked).toHaveLength(1);
        expect(hpChanged[0]).toMatchObject({ targetId: 'attacker', round: 1 });
        expect(hpChanged[0].oldPct).toBeCloseTo(100, 6);
        expect(hpChanged[0].newPct).toBeCloseTo(75, 6);
    });

    // ── Test 2: one hp-changed per turn-start DoT batch, NO attacked for it ───────
    // A dot-only enemy (corrosion, no direct damage → synthesized basic suppressed)
    // seeds a corrosion DoT on the tank in round 1. The tank (focus, speed 100) ticks
    // its DoTs at its round-2 turn-start → the aggregate batch routes through
    // applyIncomingToTarget → exactly ONE additional hp-changed at round 2, and the
    // DoT is NOT a direct weapon hit → NO `attacked` event ever fires.
    it('emits ONE hp-changed for a turn-start DoT batch, with NO attacked event for the DoT', () => {
        const corrosionDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 2, duration: 5 },
            });
        const dotEnemy = manualEnemy('dotEnemy', 1000, 50, {
            shipSkills: {
                slots: [{ slot: 'active', abilities: [corrosionDot()] }],
            },
        });

        const { hpChanged, attacked } = collect(
            healBase({
                numRounds: 2,
                hp: 1_000_000, // huge so the corrosion tick never kills the tank
                enemyAttackers: [dotEnemy],
            })
        );

        // No attacked events at all: a dot-only enemy with no direct damage has its
        // synthesized basic suppressed (DoTs are not "directly damaged").
        // Note: the 0 here is incidental to this test's purpose — it is a side-effect of
        // the synthesized-basic-suppression feature (PR 1), not part of the DoT-batch
        // hp-changed assertion being tested. If that feature ever changes, update accordingly.
        expect(attacked).toHaveLength(0);

        // Exactly ONE hp-changed: round 1 the DoT is not yet applied (tick = 0 → no emit);
        // round 2 the DoT ticks (the aggregate batch) → one emit, at round 2.
        expect(hpChanged).toHaveLength(1);
        const e = hpChanged[0];
        expect(e.targetId).toBe('attacker');
        expect(e.round).toBe(2);
        // The tick reduced HP: newPct < oldPct, both exact and in range.
        expect(e.oldPct).toBeCloseTo(100, 6);
        expect(e.newPct).toBeLessThan(100);
        expect(e.newPct).toBeGreaterThan(0);
    });

    // ── Test 3: Cheat-Death save emits hp-changed with a small positive newPct ────
    // A lethal hit on a Cheat-Death-carrying tank is intercepted (survive at 1 HP).
    // The hp-changed is emitted AFTER the intercept → newPct reflects 1 HP (small but
    // > 0), oldPct is the pre-hit value (100). cheat-death-activated also fires.
    it('Cheat-Death save: emits hp-changed with small positive newPct (1 HP) plus cheat-death-activated', () => {
        idCounter = 0;
        const bus = createEventBus();
        const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        bus.on('hp-changed', (e) => hpChanged.push(e));
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        runCombat(
            healBase({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal in one hit → intercepted at 1 HP
                bus,
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        // Cheat Death fired, tank not destroyed.
        expect(cheated).toHaveLength(1);
        expect(destroyed.filter((d) => d.actorId === 'attacker')).toHaveLength(0);

        // hp-changed emitted (the save counts as a downward crossing). newPct = 1 HP of
        // 2000 max = 0.05% — small but strictly > 0. oldPct = pre-hit 100%.
        const tankHpChanged = hpChanged.filter((e) => e.targetId === 'attacker');
        expect(tankHpChanged).toHaveLength(1);
        const e = tankHpChanged[0];
        expect(e.round).toBe(1);
        expect(e.oldPct).toBeCloseTo(100, 6);
        expect(e.newPct).toBeCloseTo((100 * 1) / 2000, 6); // 0.05% — small but > 0
    });

    // ── Test 4: killed tank emits ship-destroyed, NO hp-changed for that attack ───
    // A lethal hit on a tank WITHOUT Cheat Death destroys it → ship-destroyed, and the
    // killed path does NOT emit a posthumous hp-changed.
    it('killed tank (no Cheat Death): emits ship-destroyed, NO hp-changed for the lethal attack', () => {
        idCounter = 0;
        const bus = createEventBus();
        const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
        const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
        bus.on('hp-changed', (e) => hpChanged.push(e));
        bus.on('ship-destroyed', (e) => destroyed.push(e));
        runCombat(
            healBase({
                numRounds: 1,
                hp: 2000, // enemy hits for 3000 → lethal, no Cheat Death → destroyed
                bus,
                selfBuffs: [], // no Cheat Death
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        // Tank destroyed on round 1.
        expect(destroyed.filter((d) => d.actorId === 'attacker')).toHaveLength(1);
        // NO posthumous hp-changed for the heal target.
        expect(hpChanged.filter((e) => e.targetId === 'attacker')).toHaveLength(0);
    });

    // ── Test 5: zero-damage attack (shield fully absorbs) still emits (EMIT-ALWAYS) ──
    // A shield large enough to absorb the whole hit leaves HP unchanged. The closure
    // emits unconditionally on the survival path → one hp-changed with oldPct === newPct.
    it('zero-damage attack (shield fully absorbs): still emits hp-changed with oldPct === newPct', () => {
        const { hpChanged } = collect(
            healBase({
                numRounds: 1,
                hp: 10_000,
                // Shield 50% of hp = 5000 pool; enemy attack 3000 → fully absorbed, HP unchanged.
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'shield1',
                                    type: 'shield',
                                    target: 'self',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'shield', pct: 50, basis: 'hp' },
                                },
                            ],
                        },
                    ],
                },
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        // The tank (focus, speed 100) shields on its turn BEFORE the enemy (speed 50) hits.
        // The 3000 attack is fully absorbed by the 5000 pool → HP unchanged → oldPct === newPct.
        expect(hpChanged).toHaveLength(1);
        const e = hpChanged[0];
        expect(e.targetId).toBe('attacker');
        expect(e.round).toBe(1);
        expect(e.oldPct).toBeCloseTo(100, 6);
        expect(e.newPct).toBeCloseTo(e.oldPct, 6);
        expect(e.newPct).toBeCloseTo(100, 6);
    });
});
