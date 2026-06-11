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
import { describe, it, expect, vi } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';
import {
    registerReactiveListeners,
    executeIntent,
    Intent,
    IntentExecContext,
    ReactiveAbility,
} from '../triggers';
import { createStatusEngine } from '../statusEngine';
import type { PlayerActorRuntime } from '../playerTurn';
import type { CombatActor } from '../state';

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4c PR 3 Task 3 — on-hp-threshold-crossed listener + condition scrub +
// buff oncePerCombat. Drives registerReactiveListeners + createEventBus directly
// (unit-level), mirroring the on-attacked unit tests in triggers.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Self hp-threshold condition (trigger CONFIG, not a drain-time gate). */
const selfThresholdBelow = (n: number) =>
    ({
        subject: 'hp-threshold',
        derivable: true,
        hpComparator: 'below',
        hpPercent: n,
        hpSubject: 'self',
    }) as const;

/** A crossing-triggered ability (target-agnostic — listener only reads conditions). */
const crossingAbility = (
    n: number | undefined,
    partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>
): Ability => ({
    id: `hx${++idCounter}`,
    target: 'self',
    trigger: 'on-hp-threshold-crossed',
    conditions: n === undefined ? [] : [selfThresholdBelow(n)],
    ...partial,
});

describe('Phase 4c PR 3 Task 3 — on-hp-threshold-crossed listener', () => {
    // Harness: register one owner's crossing ability, capture enqueued intents.
    const setup = (ability: Ability, ownerId = 'tank') => {
        idCounter = 0;
        const bus = createEventBus();
        const enqueued: Intent[] = [];
        const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
        registerReactiveListeners({
            bus,
            perOwner: [{ ownerId, reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isEnemySide: (id) => id === 'enemy-dummy',
        });
        const fire = (oldPct: number, newPct: number, targetId = ownerId, round = 1) =>
            bus.emit({ type: 'hp-changed', targetId, round, oldPct, newPct });
        return { bus, enqueued, fire };
    };

    const buff = crossingAbility(40, {
        type: 'buff',
        config: {
            type: 'buff',
            buffName: 'Last Stand',
            stacks: 1,
            parsedEffects: { defense: 50 },
            isStackable: false,
            duration: 2,
        },
    });

    it('fires when the owner crosses below the threshold (45 → 35)', () => {
        const { enqueued, fire } = setup(buff);
        fire(45, 35);
        expect(enqueued).toHaveLength(1);
        expect(enqueued[0].ownerId).toBe('tank');
        expect(enqueued[0].ability.id).toBe(buff.id);
    });

    it('boundary: 40 → 35 fires (oldPct >= N), 40 → 40 and 35 → 30 do NOT, 35 → 60 (upward) does NOT', () => {
        const { enqueued, fire } = setup(buff);
        fire(40, 35); // >= 40 then below 40 → fires
        fire(40, 40); // newPct not < 40 → no
        fire(35, 30); // oldPct already below 40 → no fresh crossing
        fire(35, 60); // upward → no
        expect(enqueued).toHaveLength(1);
    });

    it('ignores hp-changed events for other actors (targetId !== ownerId)', () => {
        const { enqueued, fire } = setup(buff);
        fire(45, 35, 'other-ally'); // a different player actor crosses
        fire(45, 35, 'enemy-dummy'); // an enemy crosses
        expect(enqueued).toHaveLength(0);
    });

    it('an ability with NO self hp-threshold condition is dormant (never enqueues)', () => {
        const dormant = crossingAbility(undefined, {
            type: 'buff',
            config: {
                type: 'buff',
                buffName: 'No Threshold',
                stacks: 1,
                parsedEffects: { defense: 50 },
                isStackable: false,
                duration: 2,
            },
        });
        const { enqueued, fire } = setup(dormant);
        fire(45, 35); // would be a crossing IF a threshold were configured
        expect(enqueued).toHaveLength(0);
    });
});

describe('Phase 4c PR 3 Task 3 — executor: buff oncePerCombat + threshold scrub', () => {
    // Minimal runtime (the buff branch reads sourceId/landing only via the gate path;
    // a bare actor suffices, mirroring the damagedAllyId buff harness in triggers.test.ts).
    const runtime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    const buildCtx = (selfHpPctFor?: (ownerId: string) => number): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy' } as CombatActor,
            enemyId: 'enemy',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['tank', runtime('tank')]]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['tank'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
            oncePerCombatFired: new Set<string>(),
            ...(selfHpPctFor !== undefined ? { selfHpPctFor } : {}),
        };
    };

    const crossingBuffIntent = (oncePerCombat: boolean): Intent => ({
        ownerId: 'tank',
        sourceSlot: 'passive',
        ability: {
            id: 'last-stand',
            type: 'buff',
            target: 'self',
            trigger: 'on-hp-threshold-crossed',
            conditions: [selfThresholdBelow(40)],
            config: {
                type: 'buff',
                buffName: 'Last Stand',
                stacks: 1,
                parsedEffects: { defense: 50 },
                isStackable: false,
                duration: 2,
                oncePerCombat,
            },
        },
    });

    it('oncePerCombat buff executes once; the second intent is silently skipped', () => {
        const ctx = buildCtx();
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');
        executeIntent(crossingBuffIntent(true), ctx);
        executeIntent(crossingBuffIntent(true), ctx);
        expect(applySpy).toHaveBeenCalledTimes(1);
        expect(ctx.oncePerCombatFired?.has('tank:last-stand')).toBe(true);
    });

    it('a NON-flagged crossing buff applies on every intent (no cap)', () => {
        const ctx = buildCtx();
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');
        executeIntent(crossingBuffIntent(false), ctx);
        executeIntent(crossingBuffIntent(false), ctx);
        expect(applySpy).toHaveBeenCalledTimes(2);
    });

    it('scrub: executes even when the owner is healed back ABOVE the threshold at drain time, and the applied status carries NO self hp-threshold condition', () => {
        // selfHpPctFor reports 80% — above the 40% threshold. Without the scrub the
        // drain-time gate would re-evaluate the self hp-threshold condition and BLOCK
        // the reaction (the heal-before-drain edge). The crossing already proved the
        // threshold, so the reaction must still fire.
        const ctx = buildCtx(() => 80);
        const applySpy = vi.spyOn(ctx.statusEngine, 'applyTimedAbilityStatus');
        executeIntent(crossingBuffIntent(false), ctx);
        expect(applySpy).toHaveBeenCalledTimes(1);

        // The applied status's conditions exclude the self hp-threshold entry (hygiene).
        const status = applySpy.mock.calls[0][1] as { conditions: Array<{ subject: string }> };
        expect(
            status.conditions.some(
                (c) => (c as { subject?: string; hpSubject?: string }).subject === 'hp-threshold'
            )
        ).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4c PR 3 Task 4 — END-TO-END engine integration (runCombat, healing mode).
//
// Drives the FULL engine and asserts the crossing reactives behave correctly through
// the whole loop — emission (Task 2) → listener (Task 3) → executor → applied status →
// `buff-applied` + healTargetBuffs round overview. No production code is exercised that
// Tasks 2–3 didn't already carry; these are pure integration scenarios.
//
// Recovery mechanism for "heal back above N between crossings": a passive
// `basis:'damage-taken'` heal-leech on the heal target. It heals AFTER each enemy
// attack's drain (engine.ts §takenLeeches, applied after applyIncomingToTarget), so the
// crossing `hp-changed` (emitted INSIDE applyIncomingToTarget, pre-leech) sees the
// post-drain low HP and FIRES, then the leech restores HP above the threshold —
// re-arming the next round's crossing. Deterministic, turn-order-independent.
// ─────────────────────────────────────────────────────────────────────────────

/** A passive `on-hp-threshold-crossed` Barrier-style buff (Tycho/Kafa shape). The self
 *  hp-threshold condition is the TRIGGER config (executeIntent scrubs it at drain time). */
const crossingBarrier = (oncePerCombat: boolean): Ability => ({
    id: `barrier-${++idCounter}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-hp-threshold-crossed',
    conditions: [selfThresholdBelow(40)],
    config: {
        type: 'buff',
        buffName: 'Barrier',
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        duration: 3,
        oncePerCombat,
    },
});

/** A passive damage-taken heal-leech (heals `pct`% of each attack's damage to the heal
 *  target, AFTER the attack drains). Recovery for the re-cross scenarios. noCrit so the
 *  heal amount is deterministic (no crit-gate draw). */
const takenLeechHeal = (pct: number): Ability => ({
    id: `leech-${++idCounter}`,
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct, basis: 'damage-taken', noCrit: true },
});

/** Run a healing-mode combat with the heal target carrying the given passive abilities,
 *  bombarded by manual flat enemies, and collect buff-applied + cheat-death events. */
const runCrossing = (opts: {
    hp: number;
    numRounds: number;
    passiveAbilities: Ability[];
    enemyAttackers: EnemyAttacker[];
    selfBuffs?: {
        id: string;
        buffName: string;
        stacks: number;
        isStackable: boolean;
        parsedEffects: object;
    }[];
    healTargetId?: string;
}) => {
    idCounter = 0;
    const bus = createEventBus();
    const buffApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
    const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
    bus.on('buff-applied', (e) => buffApplied.push(e));
    bus.on('cheat-death-activated', (e) => cheated.push(e));
    bus.on('hp-changed', (e) => hpChanged.push(e));
    const result = runCombat(
        healBase({
            numRounds: opts.numRounds,
            hp: opts.hp,
            healTargetId: opts.healTargetId ?? 'attacker',
            selfBuffs: opts.selfBuffs ?? [],
            enemyAttackers: opts.enemyAttackers,
            shipSkills: {
                slots: [{ slot: 'passive', abilities: opts.passiveAbilities }],
            },
            bus,
        })
    );
    return { buffApplied, cheated, hpChanged, result };
};

describe('Phase 4c PR 3 Task 4 — on-hp-threshold-crossed end-to-end (runCombat)', () => {
    // ── Tycho-shape: oncePerCombat → exactly ONE Barrier despite TWO downward crossings ──
    // maxHp 10000, threshold 40% (4000). Each round a manual flat enemy hits 6500:
    //   R1: 10000 → 3500 (35%)  → CROSS#1 below 40 → Barrier (oncePerCombat) applies.
    //       leech 70% of 6500 = 4550 → 3500+4550 = 8050 (80.5%) → re-armed above 40.
    //   R2: 8050 →  1550 (15.5%) → CROSS#2 below 40 → Barrier oncePerCombat SKIPS the re-fire.
    // Assert exactly ONE Barrier buff-applied across the whole combat.
    it('Tycho-shape (oncePerCombat): ONE Barrier buff-applied across TWO downward crossings', () => {
        const { buffApplied, hpChanged } = runCrossing({
            hp: 10_000,
            numRounds: 2,
            passiveAbilities: [crossingBarrier(true), takenLeechHeal(70)],
            enemyAttackers: [manualEnemy('atk1', 6500)],
        });

        // NOT VACUOUS: two downward crossings of 40 actually occurred.
        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(2);

        // oncePerCombat caps the Barrier to a single application for the whole combat.
        const barriers = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Barrier'
        );
        expect(barriers).toHaveLength(1);
        expect(barriers[0].round).toBe(1);
    });

    // ── Kafa-shape: NO oncePerCombat → Barrier on EACH downward crossing (2 events) ──
    // Same HP arithmetic as Tycho-shape; only the oncePerCombat flag differs. The
    // duration-3 Barrier granted on R1 persists through R2 (assert via healTargetBuffs).
    it('Kafa-shape (no oncePerCombat): Barrier buff-applied on EACH downward crossing, and the grant persists', () => {
        const { buffApplied, hpChanged, result } = runCrossing({
            hp: 10_000,
            numRounds: 2,
            passiveAbilities: [crossingBarrier(false), takenLeechHeal(70)],
            enemyAttackers: [manualEnemy('atk1', 6500)],
        });

        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(2);

        // One Barrier buff-applied per downward crossing → two events (R1 and R2).
        const barriers = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Barrier'
        );
        expect(barriers).toHaveLength(2);
        expect(barriers.map((b) => b.round)).toEqual([1, 2]);

        // The R1 grant (duration 3) persists into R2's round overview — assert via the
        // heal target's round-2 buffs (the duration outlives the heal back above N).
        const rounds = result.healing!.rounds;
        expect(rounds[1].healTargetBuffs.map((b) => b.buffName)).toContain('Barrier');
    });

    // ── Cheat-Death save crossing: a 100→1-HP save IS a downward crossing → Barrier fires ──
    // A lethal hit on a full-HP Cheat-Death tank is intercepted at 1 HP (0.05% of 2000).
    // The hp-changed is emitted AFTER the intercept (100 → 0.05) → a downward crossing of
    // 40 → the crossing reaction fires in the SAME round as cheat-death-activated.
    it('Cheat-Death save: Barrier buff-applied alongside cheat-death-activated in the same round', () => {
        const { buffApplied, cheated, hpChanged } = runCrossing({
            hp: 2000, // enemy 3000 → lethal in one hit → intercepted at 1 HP
            numRounds: 1,
            passiveAbilities: [crossingBarrier(false)],
            selfBuffs: [cheatDeathBuff()],
            enemyAttackers: [manualEnemy('atk1', 3000)],
        });

        // Cheat Death fired on round 1.
        expect(cheated).toHaveLength(1);
        expect(cheated[0].round).toBe(1);

        // The save is a downward crossing of 40 (100 → ~0.05%).
        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(1);

        // The crossing reaction fired in the same round as the save.
        const barriers = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Barrier'
        );
        expect(barriers).toHaveLength(1);
        expect(barriers[0].round).toBe(1);
    });

    // ── DoT-tick crossing: a turn-start Corrosion tick (NOT direct damage) crosses below N ──
    // The tank carries a Corrosion DoT seeded by a dot-only enemy in R1. The direct damage
    // is tuned so HP stays ABOVE the threshold from attacks alone, and ONLY the R2 turn-start
    // DoT batch takes it below 40 — per the locked decision, DoT intake emits hp-changed too,
    // so the crossing reaction must fire on the tick.
    it('DoT-tick crossing: Barrier buff-applied when ONLY the turn-start DoT batch crosses below the threshold', () => {
        // A dot-only enemy: corrosion (no direct damage → synthesized basic suppressed) so HP
        // is reduced ONLY by the turn-start DoT tick. Tank maxHp 1000 with a tier-7 / 10-stack
        // corrosion makes the R2 tick bite from 100% straight to 30% — a single downward
        // crossing of 40% sourced ENTIRELY from the DoT batch (no direct attack involved).
        const corrosionDot: Ability = {
            id: `dot-${++idCounter}`,
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', tier: 7, stacks: 10, duration: 5 },
        };
        const dotEnemy = manualEnemy('dotEnemy', 1000, 50, {
            shipSkills: { slots: [{ slot: 'active', abilities: [corrosionDot] }] },
        });

        const { buffApplied, hpChanged } = runCrossing({
            hp: 1000,
            numRounds: 2,
            passiveAbilities: [crossingBarrier(false)],
            enemyAttackers: [dotEnemy],
        });

        // The crossing came from a DoT tick (round 2), NOT a direct attack: there is exactly
        // one downward crossing and it lands on round 2 (round 1 the DoT is not yet ticking).
        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(1);
        expect(downwardCrossings[0].round).toBe(2);

        // The crossing reaction fired on the tick.
        const barriers = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Barrier'
        );
        expect(barriers).toHaveLength(1);
        expect(barriers[0].round).toBe(2);
    });

    // ── DPS-mode inertness: no healTargetId → the crossing trigger is fully dormant ──
    // An attacker-only run (DPS mode, no enemyAttackers, no healTargetId) carrying the same
    // crossing-Barrier passive. The trigger partitions to REACTIVE (isReactiveAbility →
    // buff + live trigger), so it is NOT seeded by seedPassiveTimedStatuses → no phantom
    // round-1 grant. And with no heal target there is no tank-side hp-changed to fire it →
    // zero Barrier buff-applied across the whole DPS run.
    it('DPS-mode inertness: attacker-only run grants NO Barrier (no round-1 phantom seed, no crossing fire)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const buffApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('buff-applied', (e) => buffApplied.push(e));
        const result = runCombat(
            healBase({
                numRounds: 3,
                hp: 10_000,
                // DPS mode: NO healTargetId, NO enemyAttackers.
                healTargetId: undefined,
                enemyHp: 10_000_000,
                shipSkills: {
                    slots: [{ slot: 'passive', abilities: [crossingBarrier(false)] }],
                },
                bus,
            })
        );

        // DPS mode → no healing block at all.
        expect(result.healing).toBeUndefined();
        // The crossing-Barrier passive is reactive → not seeded → NO phantom round-1 grant,
        // and no hp-changed in DPS mode → never fires. Zero Barrier across the whole run.
        const barriers = buffApplied.filter((e) => e.buffName === 'Barrier');
        expect(barriers).toHaveLength(0);
    });
});
