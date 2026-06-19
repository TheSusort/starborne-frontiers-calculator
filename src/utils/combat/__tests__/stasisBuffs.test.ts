import { describe, it, expect } from 'vitest';
import { STASIS_BUFFS, isStasis } from '../stasisBuffs';

describe('stasisBuffs — Stasis status model (B2)', () => {
    it('STASIS_BUFFS contains exactly the bare "Stasis" name', () => {
        expect(STASIS_BUFFS.has('Stasis')).toBe(true);
        expect(STASIS_BUFFS.size).toBe(1);
    });
    it('isStasis recognizes "Stasis"', () => {
        expect(isStasis('Stasis')).toBe(true);
    });
    it('isStasis rejects non-Stasis names (no numeral variants exist)', () => {
        expect(isStasis('Stasis I')).toBe(false);
        expect(isStasis('Stasis II')).toBe(false);
        expect(isStasis('Disable')).toBe(false);
        expect(isStasis('Defense Down')).toBe(false);
        expect(isStasis('')).toBe(false);
    });
});
