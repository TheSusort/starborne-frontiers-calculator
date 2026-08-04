import { describe, it, expect } from 'vitest';
import {
    toSimBuffs,
    toEnemyModifiers,
    toDotAndPenModifiers,
    toEnemyDotModifier,
} from '../dpsBuffHelpers';
import { SelectedGameBuff } from '../../../types/calculator';
import { calculateBuffTotals } from '../../combat/buffTotals';

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
            detonationDamageModifier: 0,
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

// A2: hacking/security buff-fold pipeline
describe('toSimBuffs — hacking/security channels (A2)', () => {
    it('maps hacking effect to stat: hacking entry', () => {
        const result = toSimBuffs([makeBuff({ hacking: 40 })]);
        expect(result).toEqual([{ id: 'b1-hack', stat: 'hacking', value: 40 }]);
    });

    it('maps security effect to stat: security entry', () => {
        const result = toSimBuffs([makeBuff({ security: 20 })]);
        expect(result).toEqual([{ id: 'b1-sec', stat: 'security', value: 20 }]);
    });

    it('multiplies hacking by stacks', () => {
        const result = toSimBuffs([makeBuff({ hacking: 30 }, 3)]);
        expect(result).toEqual([{ id: 'b1-hack', stat: 'hacking', value: 90 }]);
    });

    it('multiplies security by stacks', () => {
        const result = toSimBuffs([makeBuff({ security: 10 }, 2)]);
        expect(result).toEqual([{ id: 'b1-sec', stat: 'security', value: 20 }]);
    });

    it('emits both hacking and security from a single buff', () => {
        const result = toSimBuffs([makeBuff({ hacking: 40, security: 20 })]);
        expect(result).toHaveLength(2);
        expect(result.find((b) => b.stat === 'hacking')).toEqual({
            id: 'b1-hack',
            stat: 'hacking',
            value: 40,
        });
        expect(result.find((b) => b.stat === 'security')).toEqual({
            id: 'b1-sec',
            stat: 'security',
            value: 20,
        });
    });

    it('omits hacking entry when hacking is undefined', () => {
        const result = toSimBuffs([makeBuff({ attack: 10 })]);
        expect(result.every((b) => b.stat !== 'hacking')).toBe(true);
    });

    it('omits security entry when security is undefined', () => {
        const result = toSimBuffs([makeBuff({ attack: 10 })]);
        expect(result.every((b) => b.stat !== 'security')).toBe(true);
    });
});

describe('toSimBuffs — attackFlat channel (D-PR10)', () => {
    it('emits an attackFlat leaf (× stacks) but NOT the sentinel (D-PR10)', () => {
        const out = toSimBuffs([
            {
                id: 'b1',
                buffName: 'Power Infused Nanobots',
                stacks: 1,
                isStackable: false,
                parsedEffects: { attackFlat: 500, attackFlatPctOfCaster: 100 },
            },
        ]);
        expect(out).toContainEqual({ id: 'b1-attackFlat', stat: 'attackFlat', value: 500 });
        expect(out.some((b) => (b.stat as string) === 'attackFlatPctOfCaster')).toBe(false); // sentinel inert — no leaf
    });
});

describe('calculateBuffTotals — hacking/security channels (A2)', () => {
    it('sums hacking buffs', () => {
        const result = calculateBuffTotals([
            { id: 'a', stat: 'hacking', value: 40 },
            { id: 'b', stat: 'hacking', value: 30 },
        ]);
        expect(result.hackingBuff).toBe(70);
    });

    it('sums security buffs', () => {
        const result = calculateBuffTotals([
            { id: 'a', stat: 'security', value: 20 },
            { id: 'b', stat: 'security', value: 15 },
        ]);
        expect(result.securityBuff).toBe(35);
    });

    it('returns hackingBuff: 0 and securityBuff: 0 when no matching buffs', () => {
        const result = calculateBuffTotals([{ id: 'a', stat: 'attack', value: 25 }]);
        expect(result.hackingBuff).toBe(0);
        expect(result.securityBuff).toBe(0);
    });

    it('hackingBuff and securityBuff are independent channels', () => {
        const result = calculateBuffTotals([
            { id: 'a', stat: 'hacking', value: 40 },
            { id: 'b', stat: 'security', value: 20 },
        ]);
        expect(result.hackingBuff).toBe(40);
        expect(result.securityBuff).toBe(20);
    });
});

describe('toDotAndPenModifiers — detonation channel', () => {
    const buff = (detonationDamage: number, stacks = 1): SelectedGameBuff => ({
        id: `det-${detonationDamage}-${stacks}`,
        buffName: 'Out. Detonation Damage Up III',
        stacks,
        parsedEffects: { detonationDamage },
        isStackable: false,
    });

    it('sums attacker-side detonationDamage', () => {
        expect(toDotAndPenModifiers([buff(45)], []).detonationDamageModifier).toBe(45);
    });

    it('scales by stacks', () => {
        expect(toDotAndPenModifiers([buff(45, 2)], []).detonationDamageModifier).toBe(90);
    });

    it('is 0 when no buff carries the channel', () => {
        expect(toDotAndPenModifiers([], []).detonationDamageModifier).toBe(0);
    });
});
