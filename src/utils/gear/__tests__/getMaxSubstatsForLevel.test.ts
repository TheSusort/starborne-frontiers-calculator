import { describe, it, expect } from 'vitest';
import { getMaxSubstatsForLevel } from '../potentialCalculator';

describe('getMaxSubstatsForLevel', () => {
    describe('rare', () => {
        it('returns 2 before level 12', () => {
            expect(getMaxSubstatsForLevel('rare', 0)).toBe(2);
            expect(getMaxSubstatsForLevel('rare', 11)).toBe(2);
        });
        it('returns 3 at level 12', () => {
            expect(getMaxSubstatsForLevel('rare', 12)).toBe(3);
        });
        it('returns 4 at level 16', () => {
            expect(getMaxSubstatsForLevel('rare', 16)).toBe(4);
        });
    });

    describe('epic', () => {
        it('returns 3 before level 16', () => {
            expect(getMaxSubstatsForLevel('epic', 0)).toBe(3);
            expect(getMaxSubstatsForLevel('epic', 15)).toBe(3);
        });
        it('returns 4 at level 16', () => {
            expect(getMaxSubstatsForLevel('epic', 16)).toBe(4);
        });
    });

    describe('legendary', () => {
        it('always returns 4', () => {
            expect(getMaxSubstatsForLevel('legendary', 0)).toBe(4);
            expect(getMaxSubstatsForLevel('legendary', 16)).toBe(4);
        });
    });

    describe('unknown rarity (common/uncommon fallback)', () => {
        it('returns 4', () => {
            expect(getMaxSubstatsForLevel('common', 0)).toBe(4);
            expect(getMaxSubstatsForLevel('uncommon', 8)).toBe(4);
        });
    });
});
