import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// An enemy that casts a timed Def Down at the player carrier each round; hacking 0 → resisted.
const debuffEnemy = (id: string): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 10,
            hacking: 0,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'enemy-debuff',
                            type: 'debuff',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'inflict',
                                duration: 1,
                            },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    speed: 100,
    healTargetId: 'attacker',
    ...overrides,
});

describe('debuff-resisted carries the inflictor as sourceId', () => {
    it('an enemy-inflicted resisted debuff on the player carrier stamps sourceId = the enemy', () => {
        const bus = createEventBus();
        const sources: (string | undefined)[] = [];
        bus.on('debuff-resisted', (e) => {
            if (e.targetId === 'attacker') sources.push(e.sourceId);
        });
        runCombat({ ...BASE({ enemyAttackers: [debuffEnemy('enemy-deb')] }), bus });
        expect(sources.length).toBeGreaterThan(0);
        expect(sources.every((s) => s === 'enemy-deb')).toBe(true);
    });
});
