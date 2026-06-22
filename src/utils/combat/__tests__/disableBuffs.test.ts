import { describe, it, expect } from 'vitest';
import { DISABLE_BUFFS, isDisable } from '../disableBuffs';

describe('disableBuffs', () => {
    it('DISABLE_BUFFS contains Disable', () => {
        expect(DISABLE_BUFFS.has('Disable')).toBe(true);
    });
    it('isDisable returns true for Disable, false otherwise', () => {
        expect(isDisable('Disable')).toBe(true);
        expect(isDisable('Stasis')).toBe(false);
        expect(isDisable('Attack Down')).toBe(false);
    });
});
