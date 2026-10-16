import { describe, it, expect } from 'vitest';
import { BOUNTIES, BOUNTY_LEVELS, ABYSSAL_LEVEL, parseDrops } from '../bounties';

describe('parseDrops', () => {
    it('parses star, rarity letter and percent', () => {
        expect(parseDrops('4r15.6 6l1.6')).toEqual([
            { stars: 4, rarity: 'rare', chance: 15.6 },
            { stars: 6, rarity: 'legendary', chance: 1.6 },
        ]);
    });

    it('throws on a malformed token', () => {
        expect(() => parseDrops('4x15')).toThrow();
    });
});

describe('BOUNTY_LEVELS', () => {
    it('covers levels 1..33 in order', () => {
        expect(BOUNTY_LEVELS.map((l) => l.level)).toEqual(
            Array.from({ length: 33 }, (_, i) => i + 1)
        );
    });

    it("each level's drops sum to its stated gear chance (screenshot rounding ±0.3)", () => {
        for (const l of BOUNTY_LEVELS) {
            const sum = l.drops.reduce((s, d) => s + d.chance, 0);
            expect(Math.abs(sum - l.totalGearChance), `level ${l.level}`).toBeLessThanOrEqual(0.3);
        }
    });

    it('energy follows the in-game brackets', () => {
        const energy = (lvl: number) => BOUNTY_LEVELS[lvl - 1].energy;
        expect([1, 4, 5, 8, 9, 12, 13, 17, 18, 21, 22, 25, 26, 29, 30, 32, 33].map(energy)).toEqual(
            [3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11]
        );
    });

    it('pins the owner-confirmed credits', () => {
        expect(BOUNTY_LEVELS[31].credits).toBe(15000);
        expect(BOUNTY_LEVELS[32].credits).toBe(17000);
        expect(BOUNTY_LEVELS[0].credits).toBe(2000);
    });
});

describe('BOUNTIES', () => {
    it('has four bounties with three sets each', () => {
        expect(BOUNTIES).toHaveLength(4);
        for (const b of BOUNTIES) expect(b.sets).toHaveLength(3);
    });

    it('Eelun abyssal is not yet available', () => {
        expect(BOUNTIES.find((b) => b.id === 'eelun')?.abyssalAvailable).toBe(false);
        expect(ABYSSAL_LEVEL).toBe(33);
    });
});
