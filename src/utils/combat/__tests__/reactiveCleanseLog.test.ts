/**
 * A drain-time REACTIVE cleanse must surface in the combat log. AEGIS's on-ally-shield-destroyed
 * "cleanses all debuffs" credits cleanseCount but emitted no log event (cleanse-performed is
 * cast-time only, and re-emitting it would chain on-cleanse listeners) — so the reaction was
 * invisible ("no reactions logged"). It now emits a LOG-ONLY `reactive-cleanse-performed`,
 * attributed to the reacting owner (AEGIS) and carrying the cleansed ally.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});
const hit = (): Ability => ({
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const applyDebuff = (): Ability => ({
    id: 'debuff',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Defense Down II',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 5,
    },
});
const preCombatShield = (): Ability => ({
    id: 'pre-shield',
    type: 'shield',
    target: 'self',
    trigger: 'pre-combat',
    conditions: [],
    config: { type: 'shield', pct: 100, basis: 'hp' },
});
const AEGIS_P2 =
    'This Unit grants <unit-skill>Defense Up II</unit-skill> for 1 turn and <unit-aid>cleanses all</unit-aid> debuffs when an ally within the Active pattern has their Shield destroyed.';
function aegisReactiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ secondPassiveSkillText: AEGIS_P2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}
const SHIELD_HP = 100_000;

const aegisActor = (position: Position, pattern: ParsedPattern): TeamActorEngineInput =>
    ({
        id: 'aegis',
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern,
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    { slot: 'passive', abilities: aegisReactiveAbilities() },
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 20_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as unknown as TeamActorEngineInput;

/** The shielded ally sits at M4, in AEGIS's (M3) footprint. */
const shieldedAlly = (): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [noopActive()] },
            { slot: 'passive', abilities: [preCombatShield()] },
        ],
    },
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
    hp: SHIELD_HP,
    speed: 10,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
});

const enemyDebuffer = (position: Position): EnemyAttacker =>
    ({
        id: 'enemy-debuffer',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [applyDebuff()] }] },
    }) as EnemyAttacker;

const enemyBreaker = (position: Position): EnemyAttacker =>
    ({
        id: 'enemy-breaker',
        stats: {
            attack: SHIELD_HP,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 500,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
    }) as EnemyAttacker;

function run() {
    const bus = createEventBus();
    const cleanseLogs: Extract<CombatEvent, { type: 'reactive-cleanse-performed' }>[] = [];
    bus.on('reactive-cleanse-performed', (e) => cleanseLogs.push(e));
    runCombat({
        ...shieldedAlly(),
        teamActors: [aegisActor('M3', parsePattern('Pattern-Line-Support-Range-1'))],
        enemyAttackers: [enemyDebuffer('M4'), enemyBreaker('M1')],
        bus,
    });
    return cleanseLogs;
}

describe('reactive cleanse surfaces in the combat log', () => {
    it('AEGIS reacting to a destroyed shield emits reactive-cleanse-performed attributed to AEGIS', () => {
        const logs = run();
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0].casterId).toBe('aegis');
        // The cleansed ally ('attacker') and a >0 count are carried for the log line.
        expect(logs[0].perTarget.some((pt) => pt.targetId === 'attacker' && pt.count > 0)).toBe(
            true
        );
    });
});
