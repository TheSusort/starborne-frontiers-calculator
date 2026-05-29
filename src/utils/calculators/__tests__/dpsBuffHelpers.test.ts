import { describe, it, expect } from 'vitest';
import {
    toSimBuffs,
    toEnemyModifiers,
    toDotAndPenModifiers,
    toEnemyDotModifier,
} from '../dpsBuffHelpers';
import { SelectedGameBuff } from '../../../types/calculator';

const makeBuff = (
    overrides: Partial<SelectedGameBuff['parsedEffects']>,
    stacks = 1
): SelectedGameBuff => ({
    id: 'b1',
    buffName: 'Test',
    stacks,
    parsedEffects: overrides,
    isStackable: false,
});

describe('toSimBuffs', () => {
    it('returns empty array for no buffs', () => {
        expect(toSimBuffs([])).toEqual([]);
    });

    it('maps attack effect', () => {
        const result = toSimBuffs([makeBuff({ attack: 30 })]);
        expect(result).toEqual([{ id: 'b1-atk', stat: 'attack', value: 30 }]);
    });

    it('multiplies by stacks', () => {
        const result = toSimBuffs([makeBuff({ crit: 10 }, 3)]);
        expect(result).toEqual([{ id: 'b1-crit', stat: 'crit', value: 30 }]);
    });

    it('maps all four stats from one buff', () => {
        const result = toSimBuffs([
            makeBuff({ attack: 15, crit: 10, critDamage: 20, outgoingDamage: 5 }),
        ]);
        expect(result).toHaveLength(4);
    });

    it('omits undefined effects', () => {
        const result = toSimBuffs([makeBuff({ attack: 15 })]);
        expect(result.every((b) => b.stat === 'attack')).toBe(true);
    });

    it('maps defence self-buff', () => {
        expect(toSimBuffs([makeBuff({ defense: 50 })])).toEqual([
            { id: 'b1-def', stat: 'defence', value: 50 },
        ]);
    });
    it('maps hp self-buff', () => {
        expect(toSimBuffs([makeBuff({ hp: 20 })])).toEqual([
            { id: 'b1-hp', stat: 'hp', value: 20 },
        ]);
    });
});

describe('toEnemyModifiers', () => {
    it('returns zeros for no buffs', () => {
        expect(toEnemyModifiers([])).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
    });

    it('sums defense modifier across buffs', () => {
        const result = toEnemyModifiers([makeBuff({ defense: -30 }), makeBuff({ defense: -10 })]);
        expect(result.enemyDefenseModifier).toBe(-40);
    });

    it('applies stacks to defense modifier', () => {
        const result = toEnemyModifiers([makeBuff({ defense: -10 }, 2)]);
        expect(result.enemyDefenseModifier).toBe(-20);
    });

    it('sums incomingDamage modifier across buffs', () => {
        const result = toEnemyModifiers([
            makeBuff({ incomingDamage: 20 }),
            makeBuff({ incomingDamage: 10 }, 2),
        ]);
        expect(result.incomingDamageModifier).toBe(40);
    });
});

describe('toDotAndPenModifiers', () => {
    it('returns zeros for no buffs', () => {
        expect(toDotAndPenModifiers([], [])).toEqual({
            defensePenetrationBuff: 0,
            dotDamageModifier: 0,
        });
    });

    it('sums defensePenetration from attacker buffs', () => {
        const result = toDotAndPenModifiers([makeBuff({ defensePenetration: 20 })], []);
        expect(result.defensePenetrationBuff).toBe(20);
    });

    it('combines attacker dotDamage and enemy incomingDotDamage', () => {
        const result = toDotAndPenModifiers(
            [makeBuff({ dotDamage: 30 })],
            [makeBuff({ incomingDotDamage: 20 })]
        );
        expect(result.dotDamageModifier).toBe(50);
    });
});

describe('toEnemyDotModifier', () => {
    it('returns 0 for empty array', () => {
        expect(toEnemyDotModifier([])).toBe(0);
    });

    it('returns incomingDotDamage value', () => {
        expect(toEnemyDotModifier([makeBuff({ incomingDotDamage: 25 })])).toBe(25);
    });

    it('sums across multiple buffs', () => {
        expect(
            toEnemyDotModifier([
                makeBuff({ incomingDotDamage: 25 }),
                makeBuff({ incomingDotDamage: 15 }),
            ])
        ).toBe(40);
    });

    it('applies stacks', () => {
        expect(toEnemyDotModifier([makeBuff({ incomingDotDamage: 10 }, 3)])).toBe(30);
    });

    it('ignores non-dot enemy effects', () => {
        expect(toEnemyDotModifier([makeBuff({ defense: -30, incomingDamage: 20 })])).toBe(0);
    });
});
