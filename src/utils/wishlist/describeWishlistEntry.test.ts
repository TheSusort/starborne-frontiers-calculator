import { describe, it, expect } from 'vitest';
import { describeWishlistEntry } from './describeWishlistEntry';

describe('describeWishlistEntry', () => {
    it('describes stars, rarity, slot and substats', () => {
        expect(
            describeWishlistEntry({
                stars: [6],
                rarity: ['legendary'],
                slot: ['weapon'],
                subStats: [
                    { name: 'attack', type: 'percentage' },
                    { name: 'crit', type: 'percentage' },
                ],
            })
        ).toBe('6★ Legendary Weapon · ATK% + CR');
    });

    it('lists flat stats without a percent sign and mentions the main stat', () => {
        expect(
            describeWishlistEntry({
                slot: ['sensor'],
                mainStat: [{ name: 'crit', type: 'percentage' }],
                subStats: [{ name: 'attack', type: 'flat' }],
            })
        ).toBe('Sensors · Main CR · ATK');
    });

    it('states a partial substat requirement', () => {
        expect(
            describeWishlistEntry({
                subStats: [
                    { name: 'attack', type: 'percentage' },
                    { name: 'crit', type: 'percentage' },
                    { name: 'hp', type: 'percentage' },
                ],
                subStatsMin: 2,
            })
        ).toBe('2 of ATK% + CR + HP%');
    });

    it('falls back for an entry with no filters', () => {
        expect(describeWishlistEntry({})).toBe('Any gear');
    });

    it('never exceeds the 64 character name limit', () => {
        const name = describeWishlistEntry({
            stars: [1, 2, 3, 4, 5, 6],
            rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
            slot: ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'],
        });
        expect(name.length).toBeLessThanOrEqual(64);
    });
});
