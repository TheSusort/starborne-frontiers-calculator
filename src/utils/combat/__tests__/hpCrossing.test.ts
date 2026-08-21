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
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
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
    // SP-4b-2b: a run needs an opponent. Every case that measures HP intake overrides this with
    // its own `manualEnemy`; the inert default just satisfies the contract for the cases that do
    // not (0 attack, so it changes nobody's HP).
    enemyAttackers: bareEnemy(),
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
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
    mode: 'healing',
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
    // ── Test 1: one hp-changed per HP-INTAKE event — a 3-hit ability makes three ──
    // A ship-backed enemy fires a 3-hit damage ability. `hp-changed` is emitted once per
    // `applyVictimDamage` call, and SP-4b-1 changes how many of those a multi-hit cast makes: the
    // boundary places every actor and synthesizes the enemy's targeting, so the cast resolves
    // positionally onto the real focus actor and takes the per-victim apply — where the locked
    // multi-hit rule (a `hits: N` cast is N FULL-WALK attacks) means three separate HP intakes.
    // The legacy dummy-sink route drained once with the pre-summed 3000, which is why this used to
    // read as a single aggregate event. Same victim, same total, three events instead of one.
    // attack 1000, defence 0, multiplier 100, no crit → 1000 per hit on a 10000 max HP focus, so
    // the percentages step 100 → 90 → 80 → 70 and the LAST newPct is the old aggregate's 70.
    it('emits ONE hp-changed per HP intake — a 3-hit ability drains three times, ending at 70%', () => {
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

        // One hp-changed per sub-attack, matching the three `attacked` events one-for-one.
        expect(hpChanged).toHaveLength(3);
        expect(attacked).toHaveLength(3);

        for (const e of hpChanged) {
            expect(e.targetId).toBe('attacker');
            expect(e.round).toBe(1);
        }
        // The three crossings are contiguous and each is exactly one 1000-damage hit out of a
        // 10000 max HP pool: 100 → 90, 90 → 80, 80 → 70. Asserting the whole ladder (not just the
        // endpoints) is what keeps this from passing on any three events that happen to end at 70.
        expect(hpChanged.map((e) => [e.oldPct, e.newPct])).toEqual([
            [100, 90],
            [90, 80],
            [80, 70],
        ]);
        // The aggregate total is unchanged from the legacy route: 3 × 1000 off 10000 → 70%.
        expect(hpChanged[hpChanged.length - 1].newPct).toBeCloseTo(70, 6);
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
            isOpposing: (id) => id === 'enemy-dummy',
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
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['tank', runtime('tank')]]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds: ['tank'],
            lastTurnCtxByActor: new Map(),
            recordResisted: () => {},
            oncePerCombatFired: new Set<string>(),
            // FIX 3: now required — this suite has no live-HP view, so "nobody" is the honest
            // answer, supplied explicitly rather than by omission.
            lowestHpAllyIdFor: () => undefined,
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

/** A passive `on-hp-threshold-crossed` buff (Tycho/Kafa shape). Grants a generic
 *  NON-BLOCKING buff ('Reinforced' — not in BARRIER_BUFFS/CHEAT_DEATH_BUFFS/
 *  UNREMOVABLE_STATUSES/PERSISTENT_STACKING_BUFFS, so it's a plain no-op) to isolate the
 *  crossing-grant CADENCE (oncePerCombat caps to one grant; non-oncePerCombat re-fires per
 *  crossing; duration persists into the next round's overview) from Barrier's
 *  damage-immunity (which is covered in `barrier.test.ts`). The self hp-threshold condition
 *  is the TRIGGER config (executeIntent scrubs it at drain time). */
const crossingBuff = (oncePerCombat: boolean): Ability => ({
    id: `crossing-${++idCounter}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-hp-threshold-crossed',
    conditions: [selfThresholdBelow(40)],
    config: {
        type: 'buff',
        buffName: 'Reinforced',
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
            mode: 'healing',
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
    // ── Tycho-shape: oncePerCombat → exactly ONE Reinforced despite TWO downward crossings ──
    // maxHp 10000, threshold 40% (4000). Each round a manual flat enemy hits 6500:
    //   R1: 10000 → 3500 (35%)  → CROSS#1 below 40 → Reinforced (oncePerCombat) applies.
    //       leech 70% of 6500 = 4550 → 3500+4550 = 8050 (80.5%) → re-armed above 40.
    //   R2: 8050 →  1550 (15.5%) → CROSS#2 below 40 → Reinforced oncePerCombat SKIPS the re-fire.
    // Assert exactly ONE Reinforced buff-applied across the whole combat.
    it('Tycho-shape (oncePerCombat): ONE Reinforced buff-applied across TWO downward crossings', () => {
        const { buffApplied, hpChanged } = runCrossing({
            hp: 10_000,
            numRounds: 2,
            passiveAbilities: [crossingBuff(true), takenLeechHeal(70)],
            enemyAttackers: [manualEnemy('atk1', 6500)],
        });

        // NOT VACUOUS: two downward crossings of 40 actually occurred.
        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(2);

        // oncePerCombat caps the Reinforced buff to a single application for the whole combat.
        const grants = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Reinforced'
        );
        expect(grants).toHaveLength(1);
        expect(grants[0].round).toBe(1);
    });

    // ── Kafa-shape: NO oncePerCombat → Reinforced on EACH downward crossing (2 events) ──
    // Same HP arithmetic as Tycho-shape; only the oncePerCombat flag differs. The
    // duration-3 Reinforced granted on R1 persists through R2 (assert via healTargetBuffs).
    it('Kafa-shape (no oncePerCombat): Reinforced buff-applied on EACH downward crossing, and the grant persists', () => {
        const { buffApplied, hpChanged, result } = runCrossing({
            hp: 10_000,
            numRounds: 2,
            passiveAbilities: [crossingBuff(false), takenLeechHeal(70)],
            enemyAttackers: [manualEnemy('atk1', 6500)],
        });

        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(2);

        // One Reinforced buff-applied per downward crossing → two events (R1 and R2).
        const grants = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Reinforced'
        );
        expect(grants).toHaveLength(2);
        expect(grants.map((b) => b.round)).toEqual([1, 2]);

        // The R1 grant (duration 3) persists into R2's round overview — assert via the
        // heal target's round-2 buffs (the duration outlives the heal back above N).
        const rounds = result.healing!.rounds;
        expect(rounds[1].healTargetBuffs.map((b) => b.buffName)).toContain('Reinforced');
    });

    // ── Cheat-Death save crossing: a 100→1-HP save IS a downward crossing → Reinforced fires ──
    // A lethal hit on a full-HP Cheat-Death tank is intercepted at 1 HP (0.05% of 2000).
    // The hp-changed is emitted AFTER the intercept (100 → 0.05) → a downward crossing of
    // 40 → the crossing reaction fires in the SAME round as cheat-death-activated.
    it('Cheat-Death save: Reinforced buff-applied alongside cheat-death-activated in the same round', () => {
        const { buffApplied, cheated, hpChanged } = runCrossing({
            hp: 2000, // enemy 3000 → lethal in one hit → intercepted at 1 HP
            numRounds: 1,
            passiveAbilities: [crossingBuff(false)],
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
        const grants = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Reinforced'
        );
        expect(grants).toHaveLength(1);
        expect(grants[0].round).toBe(1);
    });

    // ── DoT-tick crossing: a turn-start Corrosion tick (NOT direct damage) crosses below N ──
    // The tank carries a Corrosion DoT seeded by a dot-only enemy in R1. The direct damage
    // is tuned so HP stays ABOVE the threshold from attacks alone, and ONLY the R2 turn-start
    // DoT batch takes it below 40 — per the locked decision, DoT intake emits hp-changed too,
    // so the crossing reaction must fire on the tick.
    it('DoT-tick crossing: Reinforced buff-applied when ONLY the turn-start DoT batch crosses below the threshold', () => {
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
            passiveAbilities: [crossingBuff(false)],
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
        const grants = buffApplied.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Reinforced'
        );
        expect(grants).toHaveLength(1);
        expect(grants[0].round).toBe(2);
    });

    // ── DPS-mode: the reactive crossing passive is never PRE-SEEDED ──────────────────────────
    // The crossing-buff passive partitions to REACTIVE (isReactiveAbility → buff + live trigger),
    // so `seedPassiveTimedStatuses` must NOT seed it. On an attacker-only DPS run facing an inert
    // opponent nothing ever crosses, so the ONLY way a Reinforced grant could appear is a phantom
    // round-1 seed — which makes this negative directly falsifiable (a seeding regression turns it
    // red immediately, with zero damage in the run).
    it('DPS-mode: no round-1 phantom seed — an UNDAMAGED attacker-only run grants NO Reinforced', () => {
        idCounter = 0;
        const bus = createEventBus();
        const buffApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
        bus.on('buff-applied', (e) => buffApplied.push(e));
        bus.on('hp-changed', (e) => hpChanged.push(e));
        const result = runCombat(
            healBase({
                numRounds: 3,
                hp: 10_000,
                // DPS mode: NO healTargetId. Opponent present but inert (0 attack).
                healTargetId: undefined,
                mode: 'dps',
                shipSkills: {
                    slots: [{ slot: 'passive', abilities: [crossingBuff(false)] }],
                },
                bus,
            })
        );

        // DPS mode → no healing block at all.
        expect(result.healing).toBeUndefined();
        // Premise: the focus took no HP intake, so no crossing could have fired.
        expect(hpChanged.filter((e) => e.targetId === 'attacker')).toHaveLength(0);
        // Therefore zero Reinforced == no phantom seed.
        expect(buffApplied.filter((e) => e.buffName === 'Reinforced')).toHaveLength(0);
    });

    // ── DPS-mode: a REAL crossing DOES fire the reaction ─────────────────────────────────────
    // SP-4b-2b FINDING. The case above used to double as a claim that the crossing trigger is
    // "fully dormant in DPS mode" because "there is no tank-side hp-changed in DPS mode". That
    // premise was never tested — it was masked by the fixture running with NO enemy attackers, so
    // nothing was hitting the focus. Facing the SAME 6500-attack enemy as the Tycho/Kafa cases
    // above, the DPS-mode focus DOES emit a tank-side hp-changed, DOES cross below 40%, and the
    // crossing reaction DOES grant Reinforced. Pinned here so the real behaviour is on record.
    it('DPS-mode: a real downward crossing fires the reaction (the old "dormant in DPS mode" premise was masked by having no attacker)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const buffApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
        bus.on('buff-applied', (e) => buffApplied.push(e));
        bus.on('hp-changed', (e) => hpChanged.push(e));
        runCombat(
            healBase({
                numRounds: 3,
                hp: 10_000,
                healTargetId: undefined,
                mode: 'dps',
                enemyAttackers: [manualEnemy('atk1', 6500)],
                shipSkills: {
                    slots: [{ slot: 'passive', abilities: [crossingBuff(false)] }],
                },
                bus,
            })
        );

        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(1);
        expect(downwardCrossings[0].round).toBe(1);

        const grants = buffApplied.filter((e) => e.buffName === 'Reinforced');
        expect(grants).toHaveLength(1);
        expect(grants[0].round).toBe(1);
    });

    // SELF-DISCRIMINATING TWIN of the case above. That one pins the grant in ROUND 1 — the same
    // round a PHANTOM SEED would appear (the defect the "no phantom seed" case at the top of this
    // block guards), so on its own it cannot tell a real crossing reaction from a round-1 seed that
    // happens to look like one. Here the crossing is pushed to ROUND 2 by halving the intake:
    // defence 0 means intake == raw enemy attack (see `healBase`), so 3500/round takes the focus
    // 10,000 → 6,500 (65%, no crossing) → 3,000 (30%, crossing). A grant in round 2 CANNOT be a
    // round-1 seed, so the pair pins the mechanism rather than the timing. The 6500 sibling keeps
    // its number for the deliberate parity with the Tycho/Kafa cases; this one is free to differ.
    it('DPS-mode: the crossing reaction fires in ROUND 2 when that is when the crossing happens (not a round-1 seed)', () => {
        idCounter = 0;
        const bus = createEventBus();
        const buffApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
        bus.on('buff-applied', (e) => buffApplied.push(e));
        bus.on('hp-changed', (e) => hpChanged.push(e));
        runCombat(
            healBase({
                numRounds: 3,
                hp: 10_000,
                healTargetId: undefined,
                mode: 'dps',
                enemyAttackers: [manualEnemy('atk1', 3500)],
                shipSkills: {
                    slots: [{ slot: 'passive', abilities: [crossingBuff(false)] }],
                },
                bus,
            })
        );

        const downwardCrossings = hpChanged.filter(
            (e) => e.targetId === 'attacker' && e.oldPct >= 40 && e.newPct < 40
        );
        expect(downwardCrossings).toHaveLength(1);
        expect(downwardCrossings[0].round).toBe(2);

        const grants = buffApplied.filter((e) => e.buffName === 'Reinforced');
        expect(grants).toHaveLength(1);
        expect(grants[0].round).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4c PR 3 Task 5 — Hermes/Hayyan firing-slot Cheat-Death grants become
// CAST-PATH, target-HP gated, heal-target narrowed.
//
// A `buff Cheat Death` on a FIRING slot (active/charged) used to classify as an
// always-on AURA → active from round 1 (a 4b KNOWN LIMITATION). It now classifies
// as a persistent cast-path grant (kind: 'timed', duration Infinity) that applies
// only when the slot FIRES, gated by `conditionsMet` at cast time, and — when the
// ability targets a single `ally` — lands ONLY on the heal target (Hermes shape).
// `all-allies` keeps every player recipient (Hayyan shape). Scoped to CHEAT_DEATH_BUFFS;
// every other firing-slot recurring buff keeps the aura model.
//
// Harness: the HEALER is the focus attacker; the heal target is a separate WALKED
// team actor (`tank`) bombarded by a manual flat enemy. The carve-out emits a
// `buff-applied` (duration Infinity) per recipient when the slot fires, and the
// tank's Cheat-Death intercept consumes the granted status on a later lethal hit.
// ─────────────────────────────────────────────────────────────────────────────

/** A `buff Cheat Death` ability on a firing slot, optionally target-HP gated. `target`
 *  selects the recipient routing ('ally' → narrowed to the heal target; 'all-allies' →
 *  every player). `belowPct` (when set) adds the target-HP-subject gate evaluated at the
 *  caster's turn start against the heal target's live HP%. */
const cheatDeathGrant = (opts: { target: 'ally' | 'all-allies'; belowPct?: number }): Ability => ({
    id: `cd-${++idCounter}`,
    type: 'buff',
    target: opts.target,
    trigger: 'on-cast',
    conditions:
        opts.belowPct === undefined
            ? []
            : [
                  {
                      subject: 'hp-threshold',
                      derivable: true,
                      hpComparator: 'below',
                      hpPercent: opts.belowPct,
                      hpSubject: 'target',
                  },
              ],
    config: {
        type: 'buff',
        buffName: 'Cheat Death',
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        duration: 'recurring',
    },
});

/** A walked team actor (the heal target / tank) with no skills of its own. */
const tankActor = (id: string, hp: number, speed = 30): TeamActorEngineInput => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    // SP-4b-1: the tank is the actor every scenario below needs the enemy to hit. The
    // normalization boundary places every actor and synthesizes the enemy's `front enemy`
    // targeting, so the victim is now chosen by board geometry — and an index-derived team default
    // (`M3`) sits BEHIND the focus's front-middle anchor (`M4`), which would make the HEALER the
    // one taking every hit. Claiming `M4` explicitly puts the tank back in front (the invented
    // anchor yields to an explicit placement) and keeps the enemy's fire on it.
    position: 'M4',
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** Run a healing-mode combat where the HEALER (focus attacker) carries the given
 *  firing-slot Cheat-Death grant, healing a separate walked tank under enemy fire.
 *  Collects buff-applied + skill-fired + cheat-death-activated. */
const runCastPathCheatDeath = (opts: {
    grant: Ability;
    grantSlot: 'active' | 'charged';
    chargeCount: number;
    startCharged: boolean;
    numRounds: number;
    healerSpeed: number;
    tankHp: number;
    tankSpeed?: number;
    enemy: EnemyAttacker;
}) => {
    idCounter = 0;
    const bus = createEventBus();
    const buffApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    const skillFired: Extract<CombatEvent, { type: 'skill-fired' }>[] = [];
    const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
    bus.on('buff-applied', (e) => buffApplied.push(e));
    bus.on('skill-fired', (e) => skillFired.push(e));
    bus.on('cheat-death-activated', (e) => cheated.push(e));
    const result = runCombat(
        healBase({
            numRounds: opts.numRounds,
            // The healer does NO damage of its own — its only job is the firing-slot grant.
            hp: 10_000,
            speed: opts.healerSpeed,
            chargeCount: opts.chargeCount,
            startCharged: opts.startCharged,
            hasChargedSkill: opts.grantSlot === 'charged',
            healTargetId: 'tank',
            mode: 'healing',
            teamActors: [tankActor('tank', opts.tankHp, opts.tankSpeed)],
            enemyAttackers: [opts.enemy],
            shipSkills: {
                slots: [{ slot: opts.grantSlot, abilities: [opts.grant] }],
            },
            bus,
        })
    );
    return { buffApplied, skillFired, cheated, result };
};

describe('Phase 4c PR 3 Task 5 — cast-path Cheat-Death grants (Hermes/Hayyan)', () => {
    // ── Classification + cadence: a CHARGED-slot Cheat Death is NOT an aura ──────
    // chargeCount 3, not startCharged → rounds 1-3 active, round 4 charged. The grant
    // applies ONLY on the charged-fire round — never in rounds 1-3 (an aura would be
    // active from round 1). The healer acts before the enemy so the tank stays at full
    // HP (no enemy gate here: grant is unconditional).
    it('charged-slot grant: NO Cheat Death before the charged fires; applies on the charged-fire round', () => {
        const { buffApplied, skillFired } = runCastPathCheatDeath({
            grant: cheatDeathGrant({ target: 'ally' }),
            grantSlot: 'charged',
            chargeCount: 3,
            startCharged: false,
            numRounds: 5,
            healerSpeed: 100, // healer acts before the enemy (50)
            tankHp: 1_000_000, // huge → never dies; tank HP is irrelevant (no gate)
            enemy: manualEnemy('atk1', 1000),
        });

        // The charged skill fires exactly once (round 4 for chargeCount-3, not-startCharged).
        const chargedFires = skillFired.filter(
            (e) => e.actorId === 'attacker' && e.slot === 'charged'
        );
        expect(chargedFires).toHaveLength(1);
        const chargedRound = chargedFires[0].round;

        // The grant lands ONLY on/after the charged-fire round — NEVER before (no aura).
        const cdGrants = buffApplied.filter((e) => e.buffName === 'Cheat Death');
        expect(cdGrants.length).toBeGreaterThan(0);
        expect(cdGrants.every((e) => e.round >= chargedRound)).toBe(true);
        // Specifically: the first grant is exactly the charged-fire round (NOT round 1).
        expect(Math.min(...cdGrants.map((e) => e.round))).toBe(chargedRound);
        expect(chargedRound).toBeGreaterThan(1);
    });

    // ── Narrowing: target 'ally' lands ONLY on the heal target, not the healer ──
    // startCharged → charged fires round 1. The grant is `ally` → narrowed to [healTargetId].
    // Only the tank receives a Cheat Death buff-applied; the healer (focus 'attacker') does not.
    it("target 'ally' narrows the grant to the heal target only (not the caster)", () => {
        const { buffApplied } = runCastPathCheatDeath({
            grant: cheatDeathGrant({ target: 'ally' }),
            grantSlot: 'charged',
            chargeCount: 99, // never re-charges after the startCharged round
            startCharged: true,
            numRounds: 1,
            healerSpeed: 100,
            tankHp: 1_000_000,
            enemy: manualEnemy('atk1', 1000),
        });

        const cdGrants = buffApplied.filter((e) => e.buffName === 'Cheat Death');
        // Lands on the tank (heal target) — and NOT on the healer.
        expect(cdGrants.map((e) => e.actorId)).toContain('tank');
        expect(cdGrants.map((e) => e.actorId)).not.toContain('attacker');
    });

    // ── Narrowing: target 'all-allies' (Hayyan) keeps EVERY player recipient ────
    // Same firing cadence; `all-allies` → both players (healer + tank) receive the grant,
    // but only AFTER the charged fires (not round 1 — still cast-path, not an aura).
    it("target 'all-allies' (Hayyan shape) grants to every player after the charged fires", () => {
        const { buffApplied } = runCastPathCheatDeath({
            grant: cheatDeathGrant({ target: 'all-allies' }),
            grantSlot: 'charged',
            chargeCount: 99,
            startCharged: true,
            numRounds: 1,
            healerSpeed: 100,
            tankHp: 1_000_000,
            enemy: manualEnemy('atk1', 1000),
        });

        const cdGrants = buffApplied.filter((e) => e.buffName === 'Cheat Death');
        const recipients = new Set(cdGrants.map((e) => e.actorId));
        expect(recipients.has('attacker')).toBe(true);
        expect(recipients.has('tank')).toBe(true);
        expect(cdGrants.every((e) => e.round === 1)).toBe(true);
    });

    // ── Passive-slot Cheat Death stays an AURA (Tycho start-of-combat unchanged) ──
    // A passive `buff Cheat Death` is NOT a firing slot → it keeps the aura model. The
    // tank carries it from round 1: a lethal hit on the FIRST enemy attack is intercepted.
    it('passive-slot Cheat Death stays an aura (Tycho): active from round 1, intercepts a round-1 lethal hit', () => {
        idCounter = 0;
        const bus = createEventBus();
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        const result = runCombat(
            healBase({
                numRounds: 1,
                hp: 10_000,
                speed: 100,
                healTargetId: 'tank',
                mode: 'healing',
                // PASSIVE slot → aura; tank carries Cheat Death from round 1.
                shipSkills: {
                    slots: [{ slot: 'passive', abilities: [cheatDeathGrant({ target: 'ally' })] }],
                },
                teamActors: [tankActor('tank', 2000, 30)],
                // 3000 dmg vs tank hp 2000 → lethal on the first round-1 attack.
                enemyAttackers: [manualEnemy('atk1', 3000, 80)],
                bus,
            })
        );

        // The aura is active from round 1 → the lethal round-1 hit is intercepted.
        expect(cheated).toHaveLength(1);
        expect(cheated[0]).toMatchObject({ actorId: 'tank', round: 1 });
        // Tank survived (Cheat Death floored it at 1 HP), so it was not destroyed.
        expect(result.healing!.destroyedRound).toBeUndefined();
    });

    // ── Gate: target-HP-subject `below 40` blocks the grant when the tank is healthy ──
    // startCharged → charged fires round 1. The healer acts AFTER the enemy (speed 30 vs 80)
    // so the tank takes the round-1 hit BEFORE the healer's turn → the gate reads the
    // post-hit HP%. Tank maxHp 10000, hit 1000 → 90% at the healer's turn → above 40 → BLOCKED.
    it('gate: tank above 40% at the caster turn start → grant BLOCKED', () => {
        const { buffApplied } = runCastPathCheatDeath({
            grant: cheatDeathGrant({ target: 'ally', belowPct: 40 }),
            grantSlot: 'charged',
            chargeCount: 99,
            startCharged: true,
            numRounds: 1,
            healerSpeed: 30, // healer acts AFTER the enemy (80) → reads post-hit tank HP
            tankHp: 10_000,
            tankSpeed: 10,
            enemy: manualEnemy('atk1', 1000, 80), // 1000 vs 10000 → tank at 90% → above 40
        });

        const cdGrants = buffApplied.filter((e) => e.buffName === 'Cheat Death');
        expect(cdGrants).toHaveLength(0);
    });

    // ── Gate: target-HP-subject `below 40` PASSES when the tank is hurt ─────────
    // Same shape; the enemy hits hard enough to drop the tank below 40% before the healer
    // acts. Tank maxHp 10000, hit 7000 → 30% at the healer's turn → below 40 → grant APPLIES.
    it('gate: tank below 40% at the caster turn start → grant APPLIES (to the tank only)', () => {
        const { buffApplied } = runCastPathCheatDeath({
            grant: cheatDeathGrant({ target: 'ally', belowPct: 40 }),
            grantSlot: 'charged',
            chargeCount: 99,
            startCharged: true,
            numRounds: 1,
            healerSpeed: 30,
            tankHp: 10_000,
            tankSpeed: 10,
            enemy: manualEnemy('atk1', 7000, 80), // 7000 vs 10000 → tank at 30% → below 40
        });

        const cdGrants = buffApplied.filter((e) => e.buffName === 'Cheat Death');
        expect(cdGrants.map((e) => e.actorId)).toEqual(['tank']);
        expect(cdGrants[0].round).toBe(1);
    });

    // ── Persistence + intercept: the Infinity-duration grant survives later rounds and
    // the tank's Cheat-Death intercept consumes it on a later lethal hit. ──────────
    // startCharged → grant lands round 1 (gate below 40 passes — the tank is hurt to ~30%
    // first). A later round delivers a lethal hit; the grant (never expired) is consumed.
    it('persistence: the grant survives subsequent rounds and is consumed by a later lethal hit', () => {
        const { buffApplied, cheated, result } = runCastPathCheatDeath({
            grant: cheatDeathGrant({ target: 'ally', belowPct: 40 }),
            grantSlot: 'charged',
            chargeCount: 99,
            startCharged: true,
            numRounds: 2,
            healerSpeed: 30,
            tankHp: 10_000,
            tankSpeed: 10,
            // 7000/round vs 10000 hp, no heal recovery (healer does nothing but grant):
            //   R1: 10000 → 3000 (30% → gate passes → grant lands round 1).
            //   R2: 3000  → 0    → LETHAL → the round-1 grant (never expired) intercepts at 1 HP.
            enemy: manualEnemy('atk1', 7000, 80),
        });

        // The grant landed on round 1 (gate passed) and is the ONLY application (Infinity
        // never expires → no re-application churn from family rules).
        const cdGrants = buffApplied.filter(
            (e) => e.buffName === 'Cheat Death' && e.actorId === 'tank'
        );
        expect(cdGrants).toHaveLength(1);
        expect(cdGrants[0].round).toBe(1);
        expect(cdGrants[0].duration).toBe(Infinity);

        // The persistent grant intercepts the later lethal hit (round 2) — the tank survives.
        expect(cheated).toHaveLength(1);
        expect(cheated[0]).toMatchObject({ actorId: 'tank', round: 2 });
        expect(result.healing!.destroyedRound).toBeUndefined();
    });
});
