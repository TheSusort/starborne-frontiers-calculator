import { describe, it, expect } from 'vitest';
import { dotResistLabel, isBlockDebuff } from '../debuffImmunity';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { createEventBus, CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { RegisteredAbilityStatus, ActiveBuff } from '../statusEngine';
import type { PlayerActorRuntime } from '../playerTurn';
import type { CombatActor } from '../state';

describe('debuffImmunity helpers', () => {
    describe('isBlockDebuff', () => {
        it('returns true for "Block Debuff"', () => {
            expect(isBlockDebuff('Block Debuff')).toBe(true);
        });

        it('returns false for unrelated buff names', () => {
            expect(isBlockDebuff('Attack Up I')).toBe(false);
        });
    });

    describe('dotResistLabel', () => {
        it('formats inferno with roman numeral tier', () => {
            expect(dotResistLabel('inferno', 3)).toBe('Inferno III');
        });

        it('formats corrosion with roman numeral tier', () => {
            expect(dotResistLabel('corrosion', 2)).toBe('Corrosion II');
        });

        it('formats bomb with no tier suffix', () => {
            expect(dotResistLabel('bomb', 0)).toBe('Bomb');
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: Block Debuff — cast-side timed + persistent landing fold.
//
// A target carrying `Block Debuff` auto-resists EVERY incoming timed and
// persistent-stacking debuff. We drive the engine via `runCombat` with an enemy
// attacker (the opposing caster) inflicting a TIMED debuff (`Attack Down II`) and a
// PERSISTENT-STACKING debuff (`Defense Shred`) at the heal target. The heal target —
// the focus actor `attacker` — carries `Block Debuff` (a recurring self-buff), so
// when the enemy casts, the turn target is immune. The fold returns `false` from the
// landing decision → the existing resist plumbing records the resist: the debuff
// surfaces in that enemy's `resistedDebuffs` (display) and NOT in `debuffs`.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;

const blockDebuffEngineBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
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
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000,
    healTargetId: 'attacker',
    ...overrides,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAb = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `bdka${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/**
 * An enemy attacker (speed 10 — acts AFTER the speed-100 focus actor each round, so the
 * focus actor's Block Debuff self-buff is already active when this enemy casts) whose kit
 * inflicts a basic attack + ONE timed/persistent debuff at the heal target. `hacking`
 * omitted → defaults to 200 → 100% landing (so the ONLY thing that can resist is the
 * Block Debuff immunity fold).
 */
const debuffEnemy = (debuff: Ability): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        debuff,
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

/** Focus actor (heal target) shipSkills granting a recurring `Block Debuff` self-buff. */
const blockDebuffSelfSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'block-debuff-self',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Block Debuff',
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                        parsedEffects: {},
                    },
                },
            ],
        },
    ],
});

const runWith = (debuff: Ability, focusSkills: ShipSkills) =>
    runCombat(
        blockDebuffEngineBase({
            enemyAttackers: [debuffEnemy(debuff)],
            shipSkills: focusSkills,
        })
    );

const e1Effects = (result: ReturnType<typeof runCombat>) =>
    result.healing?.rounds?.[0]?.enemyEffects.find((e) => e.enemyId === 'e1');

const timedAttackDown: Ability = {
    id: 'ad2',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Attack Down II',
        parsedEffects: { attack: -50 },
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 3,
    },
};

const persistentDefenseShred: Ability = {
    id: 'dshred',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Shred',
        parsedEffects: { defense: -2 },
        stacks: 1,
        isStackable: true,
        application: 'inflict',
        duration: 3,
    },
};

describe('Block Debuff — cast-side timed/persistent landing fold (engine)', () => {
    it('immune target auto-resists a TIMED debuff: it is in resistedDebuffs, NOT debuffs', () => {
        const entry = e1Effects(runWith(timedAttackDown, blockDebuffSelfSkills()));
        expect(entry).toBeDefined();
        expect(entry!.resistedDebuffs.map((d) => d.buffName)).toContain('Attack Down II');
        expect(entry!.debuffs.map((d) => d.buffName)).not.toContain('Attack Down II');
    });

    it('control: WITHOUT Block Debuff the same TIMED debuff lands (non-vacuity)', () => {
        const entry = e1Effects(runWith(timedAttackDown, { slots: [] }));
        expect(entry).toBeDefined();
        expect(entry!.debuffs.map((d) => d.buffName)).toContain('Attack Down II');
        expect(entry!.resistedDebuffs).toHaveLength(0);
    });

    it('immune target auto-resists a PERSISTENT-STACKING debuff: resisted, no stack added', () => {
        const entry = e1Effects(runWith(persistentDefenseShred, blockDebuffSelfSkills()));
        expect(entry).toBeDefined();
        expect(entry!.resistedDebuffs.map((d) => d.buffName)).toContain('Defense Shred');
        expect(entry!.debuffs.map((d) => d.buffName)).not.toContain('Defense Shred');
    });

    it('control: WITHOUT Block Debuff the same PERSISTENT-STACKING debuff lands (non-vacuity)', () => {
        const entry = e1Effects(runWith(persistentDefenseShred, { slots: [] }));
        expect(entry).toBeDefined();
        expect(entry!.debuffs.map((d) => d.buffName)).toContain('Defense Shred');
        expect(entry!.resistedDebuffs).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: Block Debuff — cast-side DoT block + resist event (engine).
//
// A DoT-casting attacker (enemy attacker `e1`, speed 10 — acts AFTER the speed-100
// focus actor so the focus actor's recurring Block Debuff self-buff is already live)
// inflicts an `Inferno III` DoT at the focus actor (heal target `attacker`). When that
// target carries `Block Debuff`, the cast-side DoT region must BLOCK the DoT (no entry
// appended → no `dot-applied`, the DoT never ticks) AND emit a `debuff-resisted` event
// labelled `Inferno III` (block-path only — a normal landing failure stays silent).
// We assert via the emitted events AND the per-enemy round-effects surface
// (`dots` empty, `resistedDots` carries the blocked Inferno).
// ─────────────────────────────────────────────────────────────────────────────

// An enemy attacker casting a basic attack + an Inferno III DoT. `hacking` omitted →
// defaults to 200 → 100% landing, so the ONLY thing that can block the DoT is the
// Block Debuff immunity branch.
const infernoIIIEnemy = (): EnemyAttacker =>
    ({
        id: 'e1',
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        enemyAb({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        enemyAb({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 3,
                                stacks: 2,
                                duration: 3,
                            },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

const runDotWith = (focusSkills: ShipSkills, bus?: ReturnType<typeof createEventBus>) =>
    runCombat(
        blockDebuffEngineBase({
            numRounds: 3,
            enemyAttackers: [infernoIIIEnemy()],
            shipSkills: focusSkills,
            ...(bus ? { bus } : {}),
        })
    );

describe('Block Debuff — cast-side DoT block + resist event (engine)', () => {
    it('immune target BLOCKS an inflicted DoT: no dot-applied, resisted Inferno III event + resistedDots', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('dot-applied', (e) => events.push(e as CombatEvent));
        bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));

        const result = runDotWith(blockDebuffSelfSkills(), bus);

        // No DoT was applied — the block path never appends an entry.
        expect(events.some((e) => e.type === 'dot-applied')).toBe(false);
        // A debuff-resisted event fired, labelled with the blocked DoT's name.
        const resisted = events.filter((e) => e.type === 'debuff-resisted');
        expect(resisted.length).toBeGreaterThan(0);
        expect(
            resisted.map((e) => (e.type === 'debuff-resisted' ? e.buffName : '')).filter(Boolean)
        ).toContain('Inferno III');

        // Round-effects surface: the enemy's DoT is blocked → no landed dots, resistedDots
        // carries the Inferno entry (symmetric with the timed/persistent resist surface).
        const entry = e1Effects(result);
        expect(entry).toBeDefined();
        expect(entry!.dots).toHaveLength(0);
        expect(entry!.resistedDots).toEqual([{ type: 'inferno', tier: 3, stacks: 2 }]);
    });

    it('control: WITHOUT Block Debuff the same DoT lands (dot-applied, NO resist event)', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('dot-applied', (e) => events.push(e as CombatEvent));
        bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));

        const result = runDotWith({ slots: [] }, bus);

        // The DoT lands normally → dot-applied fires, and the resist event is UNIQUE to the
        // block path (normal successful casts never emit debuff-resisted for DoTs).
        expect(events.some((e) => e.type === 'dot-applied')).toBe(true);
        expect(events.some((e) => e.type === 'debuff-resisted')).toBe(false);

        const entry = e1Effects(result);
        expect(entry).toBeDefined();
        expect(entry!.dots.map((d) => d.type)).toContain('inferno');
        expect(entry!.resistedDots).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 5: Block Debuff — reactive timed-debuff fold (executeIntent).
//
// The REACTIVE debuff executor (triggers.ts `cfg.type === 'debuff'`) applies a
// timed debuff to a target on a triggered event (on-attacked / on-crit, etc).
// When that target carries `Block Debuff`, the immunity fold must route the
// application into the EXISTING resist branch: the debuff is NOT applied to the
// target store, `recordResisted` is called, and a `debuff-resisted` event is
// emitted. We drive the executor directly (a full runCombat reactive setup is
// heavy) and seed `Block Debuff` onto the counter target's self-buff store via
// a timed self-status — exactly the read `targetCarriesBlockDebuff` performs.
// ─────────────────────────────────────────────────────────────────────────────

describe('Block Debuff — reactive timed-debuff fold (engine)', () => {
    const makeRuntime = (): PlayerActorRuntime =>
        ({
            actor: { id: 'attacker' } as CombatActor,
            // Always lands → the ONLY thing that can resist is the Block Debuff fold.
            landsTimedEnemyApplication: () => true,
            debuffLandingGate: (_rate: number) => true,
        }) as unknown as PlayerActorRuntime;

    // A reactive (on-attacked) timed debuff inflicted at a chosen counter target.
    const makeReactiveDebuffIntent = (counterTargetId?: string): Intent => ({
        ownerId: 'attacker',
        sourceSlot: 'passive',
        ability: {
            id: 'reactive-debuff',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Attack Down II',
                stacks: 1,
                parsedEffects: { attack: -50 },
                isStackable: false,
                application: 'inflict',
                duration: 3,
            },
        },
        ...(counterTargetId !== undefined ? { eventCtx: { counterTargetId } } : {}),
    });

    // Seed a `Block Debuff` self-buff onto `targetId`'s store (the read
    // `targetCarriesBlockDebuff` performs: a timed self-status on that owner).
    const seedBlockDebuff = (
        statusEngine: ReturnType<typeof createStatusEngine>,
        round: number,
        targetId: string
    ): void => {
        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: { buffName: 'Block Debuff', stacks: 1, parsedEffects: {} },
            side: 'self',
            sourceSlot: 'passive',
            conditions: [],
            casterId: targetId,
            recipients: [targetId],
            kind: 'timed',
            duration: 5,
        };
        statusEngine.applyTimedAbilityStatus(round, status, targetId);
    };

    const buildCtx = (
        immuneTargetId?: string
    ): { ctx: IntentExecContext; resisted: ActiveBuff[] } => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        if (immuneTargetId) seedBlockDebuff(se, 1, immuneTargetId);
        const resisted: ActiveBuff[] = [];
        const ctx: IntentExecContext = {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['attacker', makeRuntime()]]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['attacker'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: (r: ActiveBuff) => resisted.push(r),
        } as unknown as IntentExecContext;
        return { ctx, resisted };
    };

    it('immune counter target auto-resists a reactive TIMED debuff: not applied, resisted + event', () => {
        const { ctx, resisted } = buildCtx('enemy-1');
        const events: CombatEvent[] = [];
        ctx.bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));
        ctx.bus.on('debuff-applied', (e) => events.push(e as CombatEvent));

        executeIntent(makeReactiveDebuffIntent('enemy-1'), ctx);

        // NOT applied to the immune target's store.
        const timedEnemy1 = ctx.statusEngine.timedAbilityStatuses('enemy', undefined, 'enemy-1');
        expect(timedEnemy1.some((s) => s.active.buffName === 'Attack Down II')).toBe(false);
        // Recorded as a resist.
        expect(resisted.map((r) => r.buffName)).toContain('Attack Down II');
        // A debuff-resisted event fired; no debuff-applied event.
        expect(events.some((e) => e.type === 'debuff-resisted')).toBe(true);
        expect(events.some((e) => e.type === 'debuff-applied')).toBe(false);
    });

    it('control: WITHOUT Block Debuff the same reactive TIMED debuff lands (non-vacuity)', () => {
        const { ctx, resisted } = buildCtx(); // no immunity seeded
        const events: CombatEvent[] = [];
        ctx.bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));
        ctx.bus.on('debuff-applied', (e) => events.push(e as CombatEvent));

        executeIntent(makeReactiveDebuffIntent('enemy-1'), ctx);

        const timedEnemy1 = ctx.statusEngine.timedAbilityStatuses('enemy', undefined, 'enemy-1');
        expect(timedEnemy1.some((s) => s.active.buffName === 'Attack Down II')).toBe(true);
        expect(resisted).toHaveLength(0);
        expect(events.some((e) => e.type === 'debuff-applied')).toBe(true);
        expect(events.some((e) => e.type === 'debuff-resisted')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7: Block Debuff — reactive DoT block + resist event (executeIntent).
//
// The REACTIVE DoT executor (triggers.ts `cfg.type === 'dot'`) appends a DoT to
// the reactive target (`ctx.enemy.id`) on a triggered event, gated by a landing
// roll that is SILENT on failure. When that target carries `Block Debuff`, the
// immunity check must BLOCK the DoT (no entry appended → no `dot-applied`) AND
// emit a `debuff-resisted` event labelled with the blocked DoT (`Inferno III`) —
// block-path ONLY. Normal landing failures stay silent (byte-identical). We drive
// the executor directly, reusing the Task 5 harness, with the reactive DoT firing
// at `ctx.enemy.id` (`enemy-default`).
// ─────────────────────────────────────────────────────────────────────────────

describe('Block Debuff — reactive DoT block + resist event (engine)', () => {
    const makeRuntime = (): PlayerActorRuntime =>
        ({
            actor: { id: 'attacker' } as CombatActor,
            // Always lands → the ONLY thing that can block the DoT is the Block Debuff branch.
            landsTimedEnemyApplication: () => true,
            debuffLandingGate: (_rate: number) => true,
            liveDebuffLandingChance: 1,
        }) as unknown as PlayerActorRuntime;

    // A reactive (on-attacked) Inferno III DoT inflicted at the reactive target (ctx.enemy.id).
    const makeReactiveDotIntent = (): Intent => ({
        ownerId: 'attacker',
        sourceSlot: 'passive',
        ability: {
            id: 'reactive-dot',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'dot',
                dotType: 'inferno',
                tier: 3,
                stacks: 2,
                duration: 3,
            },
        },
    });

    const seedBlockDebuff = (
        statusEngine: ReturnType<typeof createStatusEngine>,
        round: number,
        targetId: string
    ): void => {
        const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: { buffName: 'Block Debuff', stacks: 1, parsedEffects: {} },
            side: 'self',
            sourceSlot: 'passive',
            conditions: [],
            casterId: targetId,
            recipients: [targetId],
            kind: 'timed',
            duration: 5,
        };
        statusEngine.applyTimedAbilityStatus(round, status, targetId);
    };

    const buildCtx = (immuneTargetId?: string): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        if (immuneTargetId) seedBlockDebuff(se, 1, immuneTargetId);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([['attacker', makeRuntime()]]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['attacker'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
        } as unknown as IntentExecContext;
    };

    it('immune target BLOCKS a reactive DoT: no dot-applied, resisted Inferno III event, no entry', () => {
        const ctx = buildCtx('enemy-default');
        const events: CombatEvent[] = [];
        ctx.bus.on('dot-applied', (e) => events.push(e as CombatEvent));
        ctx.bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));

        executeIntent(makeReactiveDotIntent(), ctx);

        // No DoT entry appended → no dot-applied event.
        expect(ctx.infernoEntries).toHaveLength(0);
        expect(events.some((e) => e.type === 'dot-applied')).toBe(false);
        // A debuff-resisted event fired, labelled with the blocked DoT's name.
        const resisted = events.filter((e) => e.type === 'debuff-resisted');
        expect(resisted.length).toBeGreaterThan(0);
        expect(
            resisted.map((e) => (e.type === 'debuff-resisted' ? e.buffName : '')).filter(Boolean)
        ).toContain('Inferno III');
    });

    it('control: WITHOUT Block Debuff the same reactive DoT lands (dot-applied, NO resist event)', () => {
        const ctx = buildCtx(); // no immunity seeded
        const events: CombatEvent[] = [];
        ctx.bus.on('dot-applied', (e) => events.push(e as CombatEvent));
        ctx.bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));

        executeIntent(makeReactiveDotIntent(), ctx);

        expect(ctx.infernoEntries).toHaveLength(1);
        expect(events.some((e) => e.type === 'dot-applied')).toBe(true);
        expect(events.some((e) => e.type === 'debuff-resisted')).toBe(false);
    });
});
