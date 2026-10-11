/**
 * A cast that deals no damage at all is NOT an attack and NOT direct damage (owner ruling
 * 2026-10-10): a 0-attack ship's damage clause emits no `attacked`, wakes no on-attacked
 * reaction — but every non-damage clause of the cast still resolves (its debuff lands).
 *
 * Every caster kind: the player focus, a walked team ship, and an enemy. The three arms are the
 * same fixture mirrored, so they must report the SAME event profile (the sides share one gate,
 * `castDealsDamage` in engine.ts).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';

const HP = 10_000_000;
const PROBE = 'Probe Debuff';
const RIPOSTE = 'Riposte Marker';

/** A 100% damage clause followed by a debuff that always lands. */
const castSlots: ShipSkills['slots'] = [
    {
        slot: 'active',
        abilities: [
            {
                id: 'hit',
                type: 'damage',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: { type: 'damage', multiplier: 100 },
            },
            {
                id: 'probe',
                type: 'debuff',
                target: 'enemy',
                trigger: 'on-cast',
                conditions: [],
                config: {
                    type: 'debuff',
                    buffName: PROBE,
                    parsedEffects: {},
                    stacks: 1,
                    isStackable: false,
                    duration: 3,
                    application: 'apply',
                },
            },
        ],
    },
];

/** The victim's on-attacked reaction: a self buff it gains whenever it is attacked. */
const riposteSlots: ShipSkills['slots'] = [
    {
        slot: 'passive',
        abilities: [
            {
                id: 'riposte',
                type: 'buff',
                target: 'self',
                trigger: 'on-attacked',
                conditions: [],
                config: {
                    type: 'buff',
                    buffName: RIPOSTE,
                    parsedEffects: {},
                    stacks: 1,
                    isStackable: false,
                    duration: 2,
                },
            },
        ],
    },
];

const common = {
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    defensePenetration: 0,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    chargeCount: 0,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    crit: 0,
    critDamage: 0,
    defence: 0,
    hp: HP,
    hacking: 100_000,
    security: 0,
} satisfies Partial<CombatEngineInput>;

const enemy = (
    id: string,
    attack: number,
    speed: number,
    slots: ShipSkills['slots']
): NonNullable<CombatEngineInput['enemyAttackers']>[number] => ({
    id,
    stats: {
        attack,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed,
        hacking: 100_000,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots },
});

const teamCaster = (attack: number): TeamActorEngineInput => ({
    id: 'team-caster',
    speed: 900,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: { slots: castSlots },
        stats: {
            attack,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 100_000,
            security: 0,
            defence: 0,
            hp: HP,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

type Arm = 'focus' | 'team' | 'enemy';

/** One caster of `attack` hits a victim carrying the on-attacked reaction. */
const run = (arm: Arm, attack: number) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['attacked', 'buff-applied', 'debuff-applied'] as const)
        bus.on(type, (e) => events.push(e));
    const input: CombatEngineInput =
        arm === 'focus'
            ? {
                  ...common,
                  bus,
                  attack,
                  speed: 900,
                  position: 'M4',
                  shipSkills: { slots: castSlots },
                  teamActors: [],
                  enemyAttackers: [enemy('victim', 0, 100, riposteSlots)],
              }
            : arm === 'team'
              ? {
                    ...common,
                    bus,
                    attack: 0,
                    speed: 100,
                    position: 'M3',
                    shipSkills: { slots: [] },
                    teamActors: [teamCaster(attack)],
                    enemyAttackers: [enemy('victim', 0, 50, riposteSlots)],
                }
              : {
                    ...common,
                    bus,
                    attack: 0,
                    speed: 100,
                    position: 'M4',
                    shipSkills: { slots: riposteSlots },
                    teamActors: [],
                    enemyAttackers: [enemy('caster', attack, 900, castSlots)],
                };
    runCombat(input);
    return {
        attacked: events.filter((e) => e.type === 'attacked').length,
        riposte: events.filter((e) => e.type === 'buff-applied' && e.buffName === RIPOSTE).length,
        probe: events.filter((e) => e.type === 'debuff-applied' && e.buffName === PROBE).length,
    };
};

const ARMS: Arm[] = ['focus', 'team', 'enemy'];

describe('owner ruling 2026-10-10: a cast dealing no damage is not an attack', () => {
    it.each(ARMS)('%s caster: a real hit IS an attack (control)', (arm) => {
        expect(run(arm, 10_000)).toEqual({ attacked: 1, riposte: 1, probe: 1 });
    });

    it.each(ARMS)(
        '%s caster at 0 attack: no attacked, no on-attacked reaction, the debuff still lands',
        (arm) => {
            expect(run(arm, 0)).toEqual({ attacked: 0, riposte: 0, probe: 1 });
        }
    );
});
