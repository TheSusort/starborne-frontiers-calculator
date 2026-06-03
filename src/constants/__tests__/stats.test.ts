import { describe, it, expect } from 'vitest';
import { getLimitStatLabel } from '../stats';

describe('getLimitStatLabel', () => {
    it('returns the STATS label for a base stat', () => {
        expect(getLimitStatLabel('hp')).toBe('HP');
    });
    it('returns a human label for the derived effectiveHp stat', () => {
        expect(getLimitStatLabel('effectiveHp')).toBe('Effective HP');
    });
});
