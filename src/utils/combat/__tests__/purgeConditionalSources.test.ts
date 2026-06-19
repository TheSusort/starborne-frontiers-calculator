import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

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
