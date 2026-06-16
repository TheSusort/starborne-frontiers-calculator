import { describe, it, expect } from 'vitest';
import { calculateBuffTotals } from '../playerTurn';
import { toSimBuffs } from '../../calculators/dpsBuffHelpers';
import { SelectedGameBuff } from '../../../types/calculator';

const makeSpeedBuff = (
    overrides: Partial<SelectedGameBuff['parsedEffects']>,
    stacks = 1
): SelectedGameBuff => ({
    id: 'x',
    buffName: 'Test Speed Buff',
    stacks,
    parsedEffects: overrides,
    isStackable: false,
});

describe('calculateBuffTotals — speed channel', () => {
    it('sums positive and negative speed buffs', () => {
        const result = calculateBuffTotals([
            { id: 'a', stat: 'speed', value: 30 },
            { id: 'b', stat: 'speed', value: -15 },
        ]);
        expect(result.speedBuff).toBe(15);
    });

    it('returns speedBuff: 0 when no speed buffs present', () => {
        const result = calculateBuffTotals([{ id: 'c', stat: 'attack', value: 25 }]);
        expect(result.speedBuff).toBe(0);
    });

    it('returns speedBuff: 0 for empty buff array', () => {
        const result = calculateBuffTotals([]);
        expect(result.speedBuff).toBe(0);
    });
});

describe('toSimBuffs — speed channel', () => {
    it('maps speed effect to stat: speed entry', () => {
        const result = toSimBuffs([makeSpeedBuff({ speed: 30 })]);
        expect(result).toEqual([{ id: 'x-spd', stat: 'speed', value: 30 }]);
    });

    it('multiplies speed by stacks', () => {
        const result = toSimBuffs([makeSpeedBuff({ speed: 15 }, 2)]);
        expect(result).toEqual([{ id: 'x-spd', stat: 'speed', value: 30 }]);
    });

    it('omits speed entry when speed is undefined', () => {
        const result = toSimBuffs([makeSpeedBuff({ attack: 10 })]);
        expect(result.every((b) => b.stat !== 'speed')).toBe(true);
    });

    it('includes speed alongside other effects', () => {
        const result = toSimBuffs([makeSpeedBuff({ attack: 20, speed: 30 })]);
        expect(result).toHaveLength(2);
        const speedEntry = result.find((b) => b.stat === 'speed');
        expect(speedEntry).toEqual({ id: 'x-spd', stat: 'speed', value: 30 });
    });
});
