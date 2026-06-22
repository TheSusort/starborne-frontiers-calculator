import { describe, it, expect } from 'vitest';
import { dotResistLabel, isBlockDebuff } from '../debuffImmunity';

describe('debuffImmunity helpers', () => {
    describe('isBlockDebuff', () => {
        it('returns true for "Block Debuff"', () => {
            expect(isBlockDebuff('Block Debuff')).toBe(true);
        });

        it('returns false for unrelated buff names', () => {
            expect(isBlockDebuff('Attack Up I')).toBe(false);
        });
    });

    describe('dotResistLabel', () => {
        it('formats inferno with roman numeral tier', () => {
            expect(dotResistLabel('inferno', 3)).toBe('Inferno III');
        });

        it('formats corrosion with roman numeral tier', () => {
            expect(dotResistLabel('corrosion', 2)).toBe('Corrosion II');
        });

        it('formats bomb with no tier suffix', () => {
            expect(dotResistLabel('bomb', 0)).toBe('Bomb');
        });
    });
});
