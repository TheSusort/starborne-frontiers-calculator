import { describe, it, expect } from 'vitest';
import { buildDefaultShipSkills, configShipSkillsToSimInputs } from '../configToSimInputs';
import { ShipSkills } from '../../../types/abilities';
import { ParsedBuffEffects } from '../../../types/calculator';

describe('configToSimInputs', () => {
    describe('buildDefaultShipSkills', () => {
        it('returns one active slot with a single damage ability multiplier 100', () => {
            const result = buildDefaultShipSkills();

            expect(result.slots).toHaveLength(1);
            expect(result.slots[0].slot).toBe('active');
            expect(result.slots[0].abilities).toHaveLength(1);

            const ability = result.slots[0].abilities[0];
            expect(ability.type).toBe('damage');
            expect(ability.target).toBe('enemy');
            expect(ability.trigger).toBe('on-cast');
            expect(ability.conditions).toEqual([]);
            expect(ability.config.type).toBe('damage');
            if (ability.config.type === 'damage') {
                expect(ability.config.multiplier).toBe(100);
            }
        });

        it('does not include a charged slot', () => {
            const result = buildDefaultShipSkills();
            const hasChargedSlot = result.slots.some((s) => s.slot === 'charged');
            expect(hasChargedSlot).toBe(false);
        });
    });

    describe('configShipSkillsToSimInputs', () => {
        it('converts a self buff ability to selfBuffs', () => {
            const parsedEffects: ParsedBuffEffects = { attack: 30 };
            const shipSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'test-self-buff',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'buff',
                                    buffName: 'Test Buff',
                                    parsedEffects,
                                    stacks: 1,
                                    isStackable: false,
                                },
                            },
                        ],
                    },
                ],
            };

            const result = configShipSkillsToSimInputs(shipSkills);

            expect(result.selfBuffs).toHaveLength(1);
            expect(result.selfBuffs[0].buffName).toBe('Test Buff');
            expect(result.selfBuffs[0].parsedEffects).toEqual(parsedEffects);
            expect(result.enemyDebuffs).toHaveLength(0);
        });

        it('converts an enemy debuff ability to enemyDebuffs', () => {
            const parsedEffects: ParsedBuffEffects = { defense: -20 };
            const shipSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'charged',
                        abilities: [
                            {
                                id: 'test-enemy-debuff',
                                type: 'debuff',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: {
                                    type: 'debuff',
                                    buffName: 'Defense Reduction',
                                    parsedEffects,
                                    stacks: 1,
                                    isStackable: false,
                                    application: 'apply',
                                },
                            },
                        ],
                    },
                ],
            };

            const result = configShipSkillsToSimInputs(shipSkills);

            expect(result.enemyDebuffs).toHaveLength(1);
            expect(result.enemyDebuffs[0].buffName).toBe('Defense Reduction');
            expect(result.enemyDebuffs[0].parsedEffects).toEqual(parsedEffects);
            expect(result.selfBuffs).toHaveLength(0);
        });

        it('excludes enemy-type-gated abilities when enemyType mismatches', () => {
            const shipSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'attacker-specific-buff',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [
                                    {
                                        subject: 'enemy-type',
                                        derivable: true,
                                        requiredEnemyType: 'Attacker',
                                    },
                                ],
                                config: {
                                    type: 'buff',
                                    buffName: 'Attacker Buff',
                                    parsedEffects: { attack: 10 },
                                    stacks: 1,
                                    isStackable: false,
                                },
                            },
                        ],
                    },
                ],
            };

            // When enemyType is 'Defender', the Attacker-only buff should be excluded
            const result = configShipSkillsToSimInputs(shipSkills, 'Defender');

            expect(result.selfBuffs).toHaveLength(0);
        });

        it('includes enemy-type-gated abilities when enemyType matches', () => {
            const shipSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'attacker-specific-buff',
                                type: 'buff',
                                target: 'self',
                                trigger: 'on-cast',
                                conditions: [
                                    {
                                        subject: 'enemy-type',
                                        derivable: true,
                                        requiredEnemyType: 'Attacker',
                                    },
                                ],
                                config: {
                                    type: 'buff',
                                    buffName: 'Attacker Buff',
                                    parsedEffects: { attack: 10 },
                                    stacks: 1,
                                    isStackable: false,
                                },
                            },
                        ],
                    },
                ],
            };

            // When enemyType is 'Attacker', the buff should be included
            const result = configShipSkillsToSimInputs(shipSkills, 'Attacker');

            expect(result.selfBuffs).toHaveLength(1);
            expect(result.selfBuffs[0].buffName).toBe('Attacker Buff');
        });

        it('returns empty arrays when no buff/debuff abilities exist', () => {
            const shipSkills: ShipSkills = {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'damage-ability',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 150 },
                            },
                        ],
                    },
                ],
            };

            const result = configShipSkillsToSimInputs(shipSkills);

            expect(result.selfBuffs).toHaveLength(0);
            expect(result.enemyDebuffs).toHaveLength(0);
        });
    });
});
