/**
 * Dummy `enemy` turn gate.
 *
 * The engine carries a vestigial dummy `enemy` actor (id 'enemy') that is the player-offense
 * damage sink in DPS-calc mode. In a POSITIONAL team-vs-team sim it is not a real combatant —
 * every player resolves a real positioned enemy target, so the dummy never receives anything and
 * its DoT-tick turn is a pure no-op that only leaked a phantom "enemy" line into the combat log.
 *
 * This test pins the gate: the dummy `enemy` takes a turn (emits turn-started) ONLY when the
 * battle is NOT fully positional (DPS calc / non-positional). In a positional-complete battle
 * (positioned enemies + every player positioned with an enemy target) it is excluded from the
 * turn order entirely.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `det${++idc}`,
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
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
});

const basicEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
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
    speed: 100,
    ...over,
});

const enemyTurnStartedCount = (input: CombatEngineInput): number => {
    const bus = createEventBus();
    let count = 0;
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId === 'enemy') count += 1;
    });
    runCombat({ ...input, bus });
    return count;
};

describe('dummy enemy turn gate', () => {
    it('DPS mode (no positioned enemies): the dummy enemy takes its tick turn', () => {
        idc = 0;
        // No enemyAttackers / no healTargetId → the dummy `enemy` IS the target (DPS calc).
        expect(enemyTurnStartedCount(BASE())).toBeGreaterThan(0);
    });

    it('positional team-vs-team: the dummy enemy is excluded from the turn order', () => {
        idc = 0;
        // Focus at M4 targeting a positioned enemy → positional-complete → dummy is vestigial.
        const count = enemyTurnStartedCount(
            BASE({
                healTargetId: 'attacker',
                mode: 'healing',
                position: 'M4',
                target: parsedTarget('front'),
                pattern: basePattern(),
                enemyAttackers: [basicEnemyAt('enemy-front', 'M4')],
            })
        );
        expect(count).toBe(0);
    });
});
