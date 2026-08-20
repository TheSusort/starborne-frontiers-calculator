/**
 * Bug: when Voron transforms an incoming direct hit into a DoT (no direct damage lands), the
 * engine still emits an `attacked` event carrying the raw pre-transform damage. Downstream
 * "directly damaged" reactions (Cultivator's on-ally-attacked 8% repair) then fire even though
 * NO direct damage occurred. A fully-transformed hit is not a direct hit, so it must emit no
 * `attacked` event.
 *
 * When Voron is stasised/disabled the transform passive doesn't run, so the hit lands as direct
 * damage and the `attacked` event fires normally — covered by the non-transform control here
 * (Orel without Taunt = transform gate closed = identical "no transform → attacked fires" path).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000;
const HP = 10_000_000;

const voronTransform: Ability = {
    id: 'voron-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'transform-incoming-to-dot', turns: 3, condition: 'always' },
};
const orelTransform: Ability = {
    id: 'orel-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    // Gate CLOSED (attacker holds no Taunt/Provoke) → no transform → the hit lands as direct
    // damage. Stand-in for "Voron stasised/disabled": transform doesn't run, attacked must fire.
    config: {
        type: 'transform-incoming-to-dot',
        turns: 3,
        condition: 'attacker-taunted-or-provoke',
    },
};

let basicCounter = 0;
const basicAttack = (): Ability => ({
    id: `basic-${++basicCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const victimActor = (id: string, position: Position, passive: Ability): TeamActor =>
    ({
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: {
                slots: [{ slot: 'passive', abilities: [passive] }] as ShipSkills['slots'],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

const offensiveEnemy = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
    }) as EnemyAttacker;

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

function attackedFor(input: CombatEngineInput, targetId: string) {
    const bus = createEventBus();
    const attacked: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('attacked', (e) => {
        if (e.targetId === targetId) attacked.push(e);
    });
    runCombat({ ...input, bus });
    return attacked;
}

describe('a fully DoT-transformed hit emits no `attacked` event', () => {
    it('Voron (transform active) is hit → NO attacked event fires', () => {
        const attacked = attackedFor(
            BASE({
                numRounds: 1,
                teamActors: [victimActor('voron', 'M4', voronTransform)],
                enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            }),
            'voron'
        );
        expect(attacked).toHaveLength(0);
    });

    it('control: transform gate CLOSED (stasis/disabled analogue) → hit lands, attacked FIRES', () => {
        const attacked = attackedFor(
            BASE({
                numRounds: 1,
                teamActors: [victimActor('orel', 'M4', orelTransform)],
                enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
            }),
            'orel'
        );
        expect(attacked.length).toBeGreaterThan(0);
    });
});
