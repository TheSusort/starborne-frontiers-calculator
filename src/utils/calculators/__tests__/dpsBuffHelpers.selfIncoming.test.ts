import { describe, it, expect } from 'vitest';
import { toSelfIncomingDamageModifier } from '../dpsBuffHelpers';
import type { SelectedGameBuff } from '../../../types/calculator';

function buff(incomingDamage: number, stacks = 1): SelectedGameBuff {
    return {
        id: `b-${incomingDamage}-${stacks}`,
        buffName: 'Inc. Damage Down II',
        stacks,
        parsedEffects: { incomingDamage },
        isStackable: false,
    };
}

describe('toSelfIncomingDamageModifier', () => {
    it('returns 0 for an empty list', () => {
        expect(toSelfIncomingDamageModifier([])).toBe(0);
    });

    it('sums incomingDamage across buffs', () => {
        expect(toSelfIncomingDamageModifier([buff(-30), buff(-15)])).toBe(-45);
    });

    it('multiplies each entry by its stacks', () => {
        expect(toSelfIncomingDamageModifier([buff(-10, 3)])).toBe(-30);
    });

    it('preserves sign (Inc. Damage Up = positive)', () => {
        expect(toSelfIncomingDamageModifier([buff(30)])).toBe(30);
    });

    it('ignores buffs without an incomingDamage effect', () => {
        const noEffect: SelectedGameBuff = {
            id: 'x',
            buffName: 'Attack Up I',
            stacks: 1,
            parsedEffects: { attack: 15 },
            isStackable: false,
        };
        expect(toSelfIncomingDamageModifier([noEffect])).toBe(0);
    });
});
