import { describe, it, expect, vi } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills, AbilityTarget } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { createStatusEngine, type StatusEngine } from '../statusEngine';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import type { CombatActor } from '../state';

// ---------------------------------------------------------------------------
// C2b-2 Task 1: Integration — Iridium passive purge fires on-attacked.
//
// Harness mirrors purgeReactiveIntegration.test.ts (C2b-1 T6).
//
// Layout:
//   ENEMY ('enemy-front'): speed 200 (acts FIRST), applies ≥1 removable self-buff
//          then hits Iridium. The self-buff is applied before Iridium can act, so
//          when the on-attacked reactive fires it has a real buff to remove.
//   IRIDIUM ('attacker'): speed 100 (acts AFTER the enemy). Passive carries
//          on-attacked purge count 1. When the enemy hits Iridium, the reactive
//          fires and removes 1 enemy buff.
//
// Expected per round:
//   1. Enemy (speed 200) applies its self-buff + hits Iridium.
//   2. Iridium's on-attacked reactive fires → removes 1 enemy buff → emits
//      purge-performed with casterId='attacker', targetId='enemy-front'.
//   3. Iridium acts (speed 100): deals damage (no purge on its active in this harness).
//
// After round 1: enemy applied 1 buff, Iridium's reactive removed it → 0 remaining.
// purge-performed emitted exactly once per round (the reactive; no chain).
// ---------------------------------------------------------------------------

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pcs${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// =============================================================================
// Iridium passive on-attacked purge integration test.
// =============================================================================

describe('C2b-2 T1 Integration: Iridium on-attacked reactive purge', () => {
    // Iridium's skill set: active (plain hit) + passive (on-attacked purge count 1).
    const iridiumSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 100 },
                    }),
                ],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'purge',
                        target: 'enemy',
                        trigger: 'on-attacked' as const,
                        config: { type: 'purge', count: 1 },
                    }),
                ],
            },
        ],
    });

    // Enemy: faster (speed 200 > Iridium 100), applies 1 removable self-buff then hits.
    // Speed 200 ensures the enemy pre-loads the buff BEFORE Iridium can act, and then
    // attacks Iridium (firing the on-attacked reactive).
    const buffingEnemyFast = () => ({
        id: 'enemy-front',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 200,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 10 },
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            },
                        }),
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                    ],
                },
            ],
        },
    });

    const BASE = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: iridiumSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        hp: 1_000_000_000, // Iridium immortal for the test
        healTargetId: 'attacker',
        speed: 100,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [buffingEnemyFast()],
    });

    it('enemy loses its self-buff after attacking Iridium (on-attacked reactive purges it)', () => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        // Enemy applied 'Attack Up' before attacking. Iridium's on-attacked reactive removed it.
        const remaining = engine!
            .timedAbilityStatuses('self', 'enemy-front')
            .map((b) => b.active.buffName);
        expect(remaining).toHaveLength(0);
    });

    it('purge-performed is emitted with casterId=attacker and targetId=enemy-front', () => {
        idc = 0;
        const purgeEvents: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
        const bus = createEventBus();
        bus.on('purge-performed', (e) => purgeEvents.push(e));
        runCombat({ ...BASE(), bus });

        expect(purgeEvents).toHaveLength(1);
        expect(purgeEvents[0].casterId).toBe('attacker');
        expect(purgeEvents[0].targetId).toBe('enemy-front');
        expect(purgeEvents[0].count).toBe(1);
    });
});

// =============================================================================
// C2b-2 Task 2: round-ended event fires once per round, at the round tail.
// =============================================================================

describe('C2b-2 T2: round-ended event fires once per round', () => {
    // Reuse the buffingEnemyFast + iridiumSkills harness above (3-round run).
    const iridiumSkillsSimple = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'eorad1',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    });

    const parsedTargetLocal = (selection: ParsedTarget['selection']): ParsedTarget => ({
        raw: selection,
        side: 'enemy',
        selection,
    });

    const BASE_EOR = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: iridiumSkillsSimple(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 3,
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
        hp: 1_000_000_000,
        healTargetId: 'attacker',
        speed: 100,
        position: 'M4',
        target: parsedTargetLocal('front'),
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
    });

    it('round-ended fires exactly once per round with ascending round numbers', () => {
        const roundEndedEvents: Extract<CombatEvent, { type: 'round-ended' }>[] = [];
        const bus = createEventBus();
        bus.on('round-ended', (e) => roundEndedEvents.push(e));
        runCombat({ ...BASE_EOR(), bus });

        // Exactly one event per round.
        expect(roundEndedEvents).toHaveLength(3);
        // Round numbers are sequential and ascending.
        expect(roundEndedEvents.map((e) => e.round)).toEqual([1, 2, 3]);
    });

    it('round-ended fires AFTER all turn-ended events for that round', () => {
        const eventOrder: string[] = [];
        const bus = createEventBus();
        bus.on('turn-ended', (e) => eventOrder.push(`turn-ended:${e.round}`));
        bus.on('round-ended', (e) => eventOrder.push(`round-ended:${e.round}`));
        runCombat({ ...BASE_EOR(), numRounds: 1, bus });

        // round-ended must appear after all turn-ended events for round 1.
        const roundEndedIdx = eventOrder.lastIndexOf('round-ended:1');
        const lastTurnEndedIdx = eventOrder.lastIndexOf('turn-ended:1');
        expect(roundEndedIdx).toBeGreaterThan(-1);
        expect(roundEndedIdx).toBeGreaterThan(lastTurnEndedIdx);
    });
});

// ---------------------------------------------------------------------------
// C2b-2 Task 3: executeIntent — enemy-most-buffs purge target resolution.
//
// Drives a purge intent through executeIntent directly (mirrors the
// purgeReactive.test.ts executor harness) and asserts target selection:
//   - target:'enemy-most-buffs' → ctx.enemyWithMostBuffs(ownerId) (NOT counterTargetId/enemyId)
//   - target:'enemy'            → counterTargetId ?? enemyId (unchanged)
//   - target:'enemy-most-buffs' with delegate returning undefined → ctx.enemyId fallback
// ---------------------------------------------------------------------------

/** Minimal purge intent for the executor tests (target configurable). */
function makeMostBuffsIntent(opts?: {
    target?: AbilityTarget;
    counterTargetId?: string;
}): Intent {
    const { target = 'enemy-most-buffs', counterTargetId } = opts ?? {};
    return {
        ownerId: 'caster1',
        sourceSlot: 'passive',
        ability: {
            id: 'mb-purge-ab',
            type: 'purge',
            target,
            trigger: 'end-of-round',
            conditions: [],
            config: { type: 'purge', count: 2 },
        },
        eventCtx: counterTargetId !== undefined ? { counterTargetId } : undefined,
    } as unknown as Intent;
}

/** Minimal IntentExecContext for the most-buffs executor tests. The purge spy
 *  records its target id and returns a fixed removed count (>0 so emit fires). */
function makeMostBuffsCtx(
    enemyWithMostBuffs?: (ownerId: string) => string | undefined
): { ctx: IntentExecContext; purgedCalls: Array<[string, number | 'all']> } {
    const purgedCalls: Array<[string, number | 'all']> = [];
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    vi.spyOn(se, 'purge').mockImplementation((actorId, count) => {
        purgedCalls.push([actorId, count]);
        return 2;
    });

    const bus = createEventBus();
    const ctx: IntentExecContext = {
        round: 3,
        enemy: { id: 'enemy-default' } as CombatActor,
        enemyId: 'enemy-default',
        statusEngine: se,
        bus,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([
            [
                'caster1',
                {
                    actor: { id: 'caster1' } as CombatActor,
                    healModifier: 0,
                    attack: 0,
                    defence: 0,
                    hp: 1000,
                } as never,
            ],
        ]),
        grantAllyCharges: () => {},
        grantExtraAction: () => {},
        playerIds: ['caster1'],
        lastTurnCtxByActor: new Map(),
        enemyHp: 100000,
        cumulativeDamage: 0,
        recordResisted: () => {},
        enemyWithMostBuffs,
    };

    return { ctx, purgedCalls };
}

describe('C2b-2 T3: executeIntent — enemy-most-buffs purge target', () => {
    it('target:enemy-most-buffs purges the id from enemyWithMostBuffs (not counterTargetId/enemyId)', () => {
        const spy = vi.fn(() => 'most-buffed-enemy');
        const { ctx, purgedCalls } = makeMostBuffsCtx(spy);
        // counterTargetId is set too — must be IGNORED for the most-buffs branch.
        executeIntent(makeMostBuffsIntent({ counterTargetId: 'routed-enemy' }), ctx);
        expect(spy).toHaveBeenCalledWith('caster1');
        expect(purgedCalls).toHaveLength(1);
        expect(purgedCalls[0]).toEqual(['most-buffed-enemy', 2]);
    });

    it('target:enemy still resolves counterTargetId ?? enemyId (most-buffs delegate unused)', () => {
        const spy = vi.fn(() => 'most-buffed-enemy');
        const { ctx, purgedCalls } = makeMostBuffsCtx(spy);
        executeIntent(
            makeMostBuffsIntent({ target: 'enemy', counterTargetId: 'routed-enemy' }),
            ctx
        );
        expect(spy).not.toHaveBeenCalled();
        expect(purgedCalls[0]).toEqual(['routed-enemy', 2]);
    });

    it('target:enemy falls back to ctx.enemyId when counterTargetId absent', () => {
        const { ctx, purgedCalls } = makeMostBuffsCtx(() => 'most-buffed-enemy');
        executeIntent(makeMostBuffsIntent({ target: 'enemy' }), ctx);
        expect(purgedCalls[0]).toEqual(['enemy-default', 2]);
    });

    it('target:enemy-most-buffs falls back to ctx.enemyId when delegate returns undefined', () => {
        const { ctx, purgedCalls } = makeMostBuffsCtx(() => undefined);
        executeIntent(makeMostBuffsIntent(), ctx);
        expect(purgedCalls[0]).toEqual(['enemy-default', 2]);
    });
});

// =============================================================================
// C2b-2 Task 4: Rhodium end-of-round + enemy-most-buffs purge integration test.
//
// Layout (player Rhodium vs TWO enemy actors):
//   ENEMY-A ('enemy-a'): speed 200, applies 2 self-buffs each round → MORE buffs.
//   ENEMY-B ('enemy-b'): speed 150, applies 1 self-buff each round → fewer buffs.
//   RHODIUM ('attacker'): speed 100, passive carries end-of-round purge count 2
//                         with target:'enemy-most-buffs'.
//
// Expected per round:
//   1. Enemy-A (speed 200) applies 2 self-buffs.
//   2. Enemy-B (speed 150) applies 1 self-buff.
//   3. Rhodium (speed 100) acts — no active purge in this harness.
//   4. round-ended fires → Rhodium's end-of-round purge enqueues → drains:
//      purges 2 buffs from enemy-A (has 2 > enemy-B's 1).
//   → purge-performed emitted with targetId='enemy-a', count=2.
//
// TIE scenario: both enemies carry equal buffs → first by roster order (enemy-a) chosen.
// =============================================================================

describe('C2b-2 T4 Integration: Rhodium end-of-round most-buffs purge', () => {
    const rhodiumSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 100 },
                    }),
                ],
            },
            {
                slot: 'passive',
                abilities: [
                    ab({
                        type: 'purge',
                        target: 'enemy-most-buffs' as AbilityTarget,
                        trigger: 'end-of-round' as const,
                        config: { type: 'purge', count: 2 },
                    }),
                ],
            },
        ],
    });

    // Enemy-A: applies 2 self-buffs per turn (Attack Up + Speed Up). Speed 200 → acts first.
    const enemyA = () => ({
        id: 'enemy-a',
        stats: {
            attack: 500,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 200,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 5 },
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            },
                        }),
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Speed Up',
                                parsedEffects: { speed: 5 },
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            },
                        }),
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 50 },
                        }),
                    ],
                },
            ],
        },
    });

    // Enemy-B: applies 1 self-buff per turn (Attack Up). Speed 150 → acts second.
    const enemyB = () => ({
        id: 'enemy-b',
        stats: {
            attack: 500,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 150,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M3' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 5 },
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            },
                        }),
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 50 },
                        }),
                    ],
                },
            ],
        },
    });

    const BASE_RHODIUM = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: rhodiumSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        hp: 1_000_000_000,
        healTargetId: 'attacker',
        speed: 100,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [enemyA(), enemyB()],
    });

    it('Rhodium purges 2 buffs from enemy-A (the most-buffed enemy) at end of round', () => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE_RHODIUM(),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        // After round 1: enemy-A had 2 buffs (Attack Up + Speed Up), Rhodium purged 2 of them.
        const enemyABuffs = engine!
            .timedAbilityStatuses('self', 'enemy-a')
            .map((b) => b.active.buffName);
        expect(enemyABuffs).toHaveLength(0);
        // enemy-B still has its 1 buff (Rhodium targeted enemy-A, not enemy-B).
        const enemyBBuffs = engine!
            .timedAbilityStatuses('self', 'enemy-b')
            .map((b) => b.active.buffName);
        expect(enemyBBuffs).toHaveLength(1);
    });

    it('purge-performed emitted with casterId=attacker, targetId=enemy-a, count=2', () => {
        idc = 0;
        const purgeEvents: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
        const bus = createEventBus();
        bus.on('purge-performed', (e) => purgeEvents.push(e));
        runCombat({ ...BASE_RHODIUM(), bus });

        // The end-of-round purge fires once (Rhodium targets enemy-A).
        const eorPurge = purgeEvents.find(
            (e) => e.casterId === 'attacker' && e.targetId === 'enemy-a'
        );
        expect(eorPurge).toBeDefined();
        expect(eorPurge!.count).toBe(2);
    });

    it('TIE: both enemies have equal buffs → enemy-a (first by roster order) is chosen', () => {
        // Give both enemies 1 buff each by using enemyB's skill set for enemy-A (1 buff/turn).
        idc = 0;
        const tieEnemyA = () => ({
            ...enemyA(),
            // Override skill set: applies only 1 buff (Attack Up) — same as enemy-B.
            shipSkills: {
                slots: [
                    {
                        slot: 'active' as const,
                        abilities: [
                            ab({
                                type: 'buff',
                                target: 'self',
                                config: {
                                    type: 'buff',
                                    buffName: 'Attack Up',
                                    parsedEffects: { attack: 5 },
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 99,
                                },
                            }),
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 50 },
                            }),
                        ],
                    },
                ],
            },
        });
        const purgeEvents: Extract<CombatEvent, { type: 'purge-performed' }>[] = [];
        const bus = createEventBus();
        bus.on('purge-performed', (e) => purgeEvents.push(e));
        runCombat({ ...BASE_RHODIUM(), enemyAttackers: [tieEnemyA(), enemyB()], bus });

        // Both have 1 buff; enemy-a is first in roster → selected (deterministic tie-break).
        const eorPurge = purgeEvents.find((e) => e.casterId === 'attacker');
        expect(eorPurge).toBeDefined();
        expect(eorPurge!.targetId).toBe('enemy-a');
    });
});
