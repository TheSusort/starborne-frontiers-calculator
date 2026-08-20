import { describe, it, expect } from 'vitest';
import {
    dotResistLabel,
    dotTierNumeral,
    isBlockDebuff,
    controlEffectLabel,
} from '../debuffImmunity';
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

    describe('dotTierNumeral', () => {
        // `tier` is a MAGNITUDE (corrosion 3/6/9, inferno 15/30/45, bomb 100/200/300) — the same
        // value tickDoTs divides by 100. dotTierNumeral maps that magnitude to its display level.
        it('maps corrosion magnitudes to I/II/III (base 3)', () => {
            expect(dotTierNumeral('corrosion', 3)).toBe('I');
            expect(dotTierNumeral('corrosion', 6)).toBe('II');
            expect(dotTierNumeral('corrosion', 9)).toBe('III');
        });

        it('maps inferno magnitudes to I/II/III (base 15)', () => {
            expect(dotTierNumeral('inferno', 15)).toBe('I');
            expect(dotTierNumeral('inferno', 30)).toBe('II');
            expect(dotTierNumeral('inferno', 45)).toBe('III');
        });

        it('returns "" for bomb and generic (untiered display)', () => {
            expect(dotTierNumeral('bomb', 100)).toBe('');
            expect(dotTierNumeral('generic', 5)).toBe('');
        });

        it('returns "" for a magnitude that is not an exact tier multiple', () => {
            expect(dotTierNumeral('corrosion', 5)).toBe('');
            expect(dotTierNumeral('inferno', 8)).toBe('');
        });
    });

    describe('dotResistLabel', () => {
        it('formats inferno from its magnitude (45 → III)', () => {
            expect(dotResistLabel('inferno', 45)).toBe('Inferno III');
        });

        it('formats corrosion from its magnitude (6 → II)', () => {
            expect(dotResistLabel('corrosion', 6)).toBe('Corrosion II');
        });

        it('formats corrosion tier I from its magnitude (3 → I)', () => {
            expect(dotResistLabel('corrosion', 3)).toBe('Corrosion I');
        });

        it('formats bomb with no tier suffix', () => {
            expect(dotResistLabel('bomb', 100)).toBe('Bomb');
        });

        it('formats generic as the plain untiered label', () => {
            expect(dotResistLabel('generic', 5)).toBe('Damage over Time');
        });
    });

    describe('controlEffectLabel', () => {
        it('returns "Disable" for the disable control effect', () => {
            expect(controlEffectLabel('disable')).toBe('Disable');
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
    enemyAttackers: [],
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
    mode: 'healing',
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
                                // Inferno III MAGNITUDE (15/30/45 = I/II/III) — the value the tick
                                // math and dotResistLabel both consume; 45 → 'Inferno III'.
                                tier: 45,
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
        expect(entry!.resistedDots).toEqual([{ type: 'inferno', tier: 45, stacks: 2 }]);
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
// Block Debuff — cast-side control block (engine).
//
// A control infliction (cfg.type 'control', e.g. Stasis) emits `control-applied` so
// reactions (on-stasis-applied) can fire. When the cast target carries `Block Debuff`
// the control is blocked: NO `control-applied` (so reactions do NOT fire). The
// control-classification unification moved Block-Debuff RESIST OWNERSHIP off the control
// loop onto the PARALLEL named-status path (the control's named timed debuff, symmetric
// with every debuff type) to avoid double-counting. This synthetic fixture carries the
// control ability ONLY (no parallel named debuff), so a blocked cast emits NO resist here
// — the named-status resist is asserted end-to-end by the "auto-resists an inflicted
// Stasis" integration test below (which casts the named 'Stasis' debuff).
// ─────────────────────────────────────────────────────────────────────────────

const controlEnemy = (): EnemyAttacker =>
    debuffEnemy(enemyAb({ type: 'control', config: { type: 'control', effect: 'stasis' } }));

const runControlWith = (focusSkills: ShipSkills, bus: ReturnType<typeof createEventBus>) =>
    runCombat(
        blockDebuffEngineBase({
            numRounds: 3,
            enemyAttackers: [controlEnemy()],
            shipSkills: focusSkills,
            bus,
        })
    );

describe('Block Debuff — cast-side control block (engine)', () => {
    it('immune target BLOCKS a control infliction: no control-applied (resist owned by named path)', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('control-applied', (e) => events.push(e as CombatEvent));
        bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));

        runControlWith(blockDebuffSelfSkills(), bus);

        // The control was blocked → on-stasis-applied reactions never get the signal.
        expect(events.some((e) => e.type === 'control-applied')).toBe(false);
        // The control loop no longer owns the resist — this control-only fixture has no
        // parallel named-status path, so NO debuff-resisted fires here. (The named-status
        // resist is covered by the named-'Stasis' integration test below.)
        expect(events.some((e) => e.type === 'debuff-resisted')).toBe(false);
    });

    it('control: WITHOUT Block Debuff the control fires (control-applied, NO resist) — non-vacuity', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('control-applied', (e) => events.push(e as CombatEvent));
        bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));

        runControlWith({ slots: [] }, bus);

        // The control lands normally → control-applied fires; the resist event is UNIQUE to
        // the block path (a normal control cast never emits debuff-resisted).
        expect(events.some((e) => e.type === 'control-applied')).toBe(true);
        expect(events.some((e) => e.type === 'debuff-resisted')).toBe(false);
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

    it('a RESISTED reactive timed debuff reports the RESOLVED target id (not the dummy sink)', () => {
        // Combat-log fidelity (#1): the reactive resist emit must name the ship the debuff was
        // aimed at (the counter target), not the fixed `ctx.enemy.id` dummy sink — so the log can
        // render "src → <that ship>: X resisted" instead of "src → enemy".
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('debuff-resisted', (e) => events.push(e as CombatEvent));
        const ctx: IntentExecContext = {
            round: 1,
            statusEngine: se,
            bus,
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([
                [
                    'attacker',
                    {
                        actor: { id: 'attacker' } as CombatActor,
                        // Never lands → the resist branch fires.
                        landsTimedEnemyApplication: () => false,
                        debuffLandingGate: () => true,
                    } as unknown as PlayerActorRuntime,
                ],
            ]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['attacker'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            recordResisted: () => {},
        } as unknown as IntentExecContext;

        executeIntent(makeReactiveDebuffIntent('enemy-1'), ctx);

        const resisted = events.filter((e) => e.type === 'debuff-resisted');
        expect(resisted).toHaveLength(1);
        expect(resisted[0].type === 'debuff-resisted' && resisted[0].targetId).toBe('enemy-1');
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
// the routed reactive victim on a triggered event, gated by a landing roll that is
// SILENT on failure. When that victim carries `Block Debuff`, the immunity check
// must BLOCK the DoT (no entry appended → no `dot-applied`) AND emit a
// `debuff-resisted` event labelled with the blocked DoT (`Inferno III`) —
// block-path ONLY. Normal landing failures stay silent (byte-identical). We drive
// the executor directly, reusing the Task 5 harness.
//
// SP-4c-2d: the intent now STAMPS its victim (`eventCtx.counterTargetId`), which is
// what an on-attacked reactive does in production anyway. Before that rung these two
// cases relied on the branch falling back to `ctx.enemy.id`; that fallback is now a
// no-op, so without the stamp both cases would pass VACUOUSLY (nothing lands, so
// nothing is blocked either).
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

    /** The routed victim every case here inflicts on — the id the Block Debuff is seeded against. */
    const VICTIM_ID = 'enemy-default';

    // A reactive (on-attacked) Inferno III DoT inflicted at the routed attacker.
    const makeReactiveDotIntent = (): Intent => ({
        ownerId: 'attacker',
        sourceSlot: 'passive',
        eventCtx: { counterTargetId: VICTIM_ID },
        ability: {
            id: 'reactive-dot',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-attacked',
            conditions: [],
            config: {
                type: 'dot',
                dotType: 'inferno',
                // Inferno III magnitude (see dotTierNumeral: 45 → 'Inferno III').
                tier: 45,
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
            recordResisted: () => {},
        } as unknown as IntentExecContext;
    };

    it('immune target BLOCKS a reactive DoT: no dot-applied, resisted Inferno III event, no entry', () => {
        const ctx = buildCtx(VICTIM_ID);
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

// ─────────────────────────────────────────────────────────────────────────────
// Task 8: Block Debuff — end-to-end integration coverage.
//
// The per-family seams (timed/persistent/DoT × cast/reactive) are each unit-tested
// above (Tasks 4-7). This block covers the cross-cutting cases those seams do not
// individually assert end-to-end:
//
//   1. Control-as-named-debuff: a control inflict (Stasis / Disable) reaches the
//      engine as an ordinary NAMED timed debuff routed through the same timed
//      landing fold as `Attack Down II`. So a `Block Debuff` target must auto-resist
//      it — the target never becomes stasised/disabled. We assert end-to-end via
//      the enemy round-effects surface AND the engine-local `isStasised` reader tap.
//   2. Already-landed debuffs survive: Block Debuff only gates NEW applications. A
//      debuff that landed on a target BEFORE the target gained Block Debuff stays
//      present and decrements/expires on its normal cadence — the immunity never
//      retroactively removes it. Staged at the statusEngine level (a real "before"
//      landed status + a "now" immune target, then a fresh inflict attempt).
//   3. Immunity beats landing: an attacker with a very high landing chance (would
//      otherwise definitely land) is still resisted by a Block Debuff target — the
//      immunity fold short-circuits the landing roll entirely.
// ─────────────────────────────────────────────────────────────────────────────

describe('Block Debuff — integration (engine)', () => {
    const namedControlDebuff = (buffName: string): Ability => ({
        id: `ctrl-${buffName.toLowerCase()}`,
        type: 'debuff',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'debuff',
            buffName,
            // Control inflicts carry no stat effects — they are pure named debuffs
            // routed through the timed landing path (mirrors stasis.test.ts).
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            application: 'inflict',
            duration: 3,
        },
    });

    // (1) Control-as-named-debuff blocked: Stasis & Disable are auto-resisted on a
    //     Block Debuff target — the target never enters the control state.
    it('auto-resists an inflicted Stasis: resisted, NOT applied, target never becomes stasised', () => {
        let isStasisedReader: ((actorId: string) => boolean) | undefined;
        const result = runCombat(
            blockDebuffEngineBase({
                enemyAttackers: [debuffEnemy(namedControlDebuff('Stasis'))],
                shipSkills: blockDebuffSelfSkills(),
                __testTapIsStasised: (fn) => {
                    isStasisedReader = fn;
                },
            })
        );

        const entry = e1Effects(result);
        expect(entry).toBeDefined();
        expect(entry!.resistedDebuffs.map((d) => d.buffName)).toContain('Stasis');
        expect(entry!.debuffs.map((d) => d.buffName)).not.toContain('Stasis');
        // Behavioral proof: the heal target (the Block Debuff carrier) never enters Stasis.
        expect(isStasisedReader).toBeDefined();
        expect(isStasisedReader!('attacker')).toBe(false);
    });

    it('control: WITHOUT Block Debuff the inflicted Stasis lands and stasises the target (non-vacuity)', () => {
        let isStasisedReader: ((actorId: string) => boolean) | undefined;
        const result = runCombat(
            blockDebuffEngineBase({
                enemyAttackers: [debuffEnemy(namedControlDebuff('Stasis'))],
                shipSkills: { slots: [] },
                __testTapIsStasised: (fn) => {
                    isStasisedReader = fn;
                },
            })
        );

        const entry = e1Effects(result);
        expect(entry).toBeDefined();
        expect(entry!.debuffs.map((d) => d.buffName)).toContain('Stasis');
        expect(entry!.resistedDebuffs).toHaveLength(0);
        expect(isStasisedReader).toBeDefined();
        expect(isStasisedReader!('attacker')).toBe(true);
    });

    it('auto-resists an inflicted Disable (named control debuff): resisted, NOT applied', () => {
        const entry = e1Effects(runWith(namedControlDebuff('Disable'), blockDebuffSelfSkills()));
        expect(entry).toBeDefined();
        expect(entry!.resistedDebuffs.map((d) => d.buffName)).toContain('Disable');
        expect(entry!.debuffs.map((d) => d.buffName)).not.toContain('Disable');
    });

    // (2) Already-landed debuff survives the target later becoming immune.
    //     Staged at the statusEngine level: apply Attack Down II to enemy-1 while it is
    //     NOT immune (round 1), THEN seed Block Debuff on enemy-1, THEN fire a fresh
    //     reactive inflict. The pre-existing debuff must remain and decrement normally;
    //     only the NEW inflict is blocked.
    it('already-landed debuff survives when the target later gains Block Debuff (and ticks down normally)', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);

        // "Before": Attack Down II lands on enemy-1 (no immunity yet), 2-turn duration.
        const landed: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: { buffName: 'Attack Down II', stacks: 1, parsedEffects: { attack: -50 } },
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            casterId: 'attacker',
            recipients: ['enemy-1'],
            kind: 'timed',
            duration: 2,
        };
        se.applyTimedAbilityStatus(1, landed, undefined, 'enemy-1');
        expect(
            se
                .timedAbilityStatuses('enemy', undefined, 'enemy-1')
                .some((s) => s.active.buffName === 'Attack Down II')
        ).toBe(true);

        // "Now": enemy-1 gains Block Debuff (self-buff on its own store).
        const block: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
            payload: { buffName: 'Block Debuff', stacks: 1, parsedEffects: {} },
            side: 'self',
            sourceSlot: 'passive',
            conditions: [],
            casterId: 'enemy-1',
            recipients: ['enemy-1'],
            kind: 'timed',
            duration: 5,
        };
        se.applyTimedAbilityStatus(1, block, 'enemy-1');

        // A fresh inflict attempt against the now-immune enemy-1 is resisted...
        const resisted: ActiveBuff[] = [];
        const ctx: IntentExecContext = {
            round: 1,
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            runtimes: new Map([
                [
                    'attacker',
                    {
                        actor: { id: 'attacker' } as CombatActor,
                        landsTimedEnemyApplication: () => true,
                        debuffLandingGate: () => true,
                    } as unknown as PlayerActorRuntime,
                ],
            ]),
            grantAllyCharges: () => {},
            grantExtraAction: () => {},
            playerIds: ['attacker'],
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            recordResisted: (r: ActiveBuff) => resisted.push(r),
        } as unknown as IntentExecContext;

        const freshInflict: Intent = {
            ownerId: 'attacker',
            sourceSlot: 'passive',
            ability: {
                id: 'fresh-debuff',
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'debuff',
                    buffName: 'Defense Down',
                    stacks: 1,
                    parsedEffects: { defense: -30 },
                    isStackable: false,
                    application: 'inflict',
                    duration: 3,
                },
            },
            eventCtx: { counterTargetId: 'enemy-1' },
        };
        executeIntent(freshInflict, ctx);

        // ...the NEW debuff is blocked...
        expect(resisted.map((r) => r.buffName)).toContain('Defense Down');
        const afterInflict = se.timedAbilityStatuses('enemy', undefined, 'enemy-1');
        expect(afterInflict.some((s) => s.active.buffName === 'Defense Down')).toBe(false);
        // ...but the ALREADY-LANDED debuff is untouched.
        expect(afterInflict.some((s) => s.active.buffName === 'Attack Down II')).toBe(true);

        // And it ticks down normally: decrement round 1 (1 turn left), round 2 → expires.
        se.decrementEnemy('enemy-1');
        expect(
            se
                .timedAbilityStatuses('enemy', undefined, 'enemy-1')
                .some((s) => s.active.buffName === 'Attack Down II')
        ).toBe(true);
        se.beginRound(2);
        se.decrementEnemy('enemy-1');
        expect(
            se
                .timedAbilityStatuses('enemy', undefined, 'enemy-1')
                .some((s) => s.active.buffName === 'Attack Down II')
        ).toBe(false);
    });

    // (3) Immunity beats landing: even a guaranteed-landing attacker is resisted.
    it('a high-landing-chance attacker is still resisted by a Block Debuff target', () => {
        // Same Task 4 timed debuff, but the enemy attacker is given a very high base
        // hacking so its live landing chance is maximal — the ONLY thing that resists
        // is the Block Debuff immunity fold.
        const highHackingEnemy: EnemyAttacker = {
            ...debuffEnemy(timedAttackDown),
            stats: { attack: 1000, crit: 0, critDamage: 0, speed: 10, hacking: 5000 },
        } as EnemyAttacker;

        const immune = e1Effects(
            runCombat(
                blockDebuffEngineBase({
                    enemyAttackers: [highHackingEnemy],
                    shipSkills: blockDebuffSelfSkills(),
                })
            )
        );
        expect(immune).toBeDefined();
        expect(immune!.resistedDebuffs.map((d) => d.buffName)).toContain('Attack Down II');
        expect(immune!.debuffs.map((d) => d.buffName)).not.toContain('Attack Down II');

        // Non-vacuity: the same high-hacking attacker DOES land on a non-immune target.
        const landed = e1Effects(
            runCombat(
                blockDebuffEngineBase({
                    enemyAttackers: [highHackingEnemy],
                    shipSkills: { slots: [] },
                })
            )
        );
        expect(landed).toBeDefined();
        expect(landed!.debuffs.map((d) => d.buffName)).toContain('Attack Down II');
        expect(landed!.resistedDebuffs).toHaveLength(0);
    });
});
