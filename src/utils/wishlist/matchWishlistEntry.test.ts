import { describe, it, expect } from 'vitest';
import { GearPiece } from '../../types/gear';
import { WishlistEntry } from '../../types/wishlist';
import { matchesWishlistEntry } from './matchWishlistEntry';

const baseGear: GearPiece = {
    id: 'g1',
    slot: 'weapon',
    stars: 5,
    rarity: 'legendary',
    setBonus: 'Vanguard' as any,
    mainStat: { name: 'attack', value: 100, type: 'flat' },
    subStats: [
        { name: 'crit', value: 10, type: 'percentage' },
        { name: 'speed', value: 5, type: 'flat' },
    ],
    shipId: undefined,
    level: 16,
} as GearPiece;

describe('matchesWishlistEntry', () => {
    it('matches when no filters are set', () => {
        const entry: WishlistEntry = { id: '1', name: 'Any', filters: {} };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('matches exact slot', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { slot: 'weapon' } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects wrong slot', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { slot: 'hull' } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('matches when piece stars >= filter stars', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { stars: 5 } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when piece stars < filter stars', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { stars: 6 } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('matches exact rarity', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { rarity: 'legendary' } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects wrong rarity', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { rarity: 'epic' } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('matches exact setBonus', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { setBonus: 'Vanguard' as any },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('matches mainStat by name ignoring flat/percentage distinction', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: { name: 'attack' } },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects wrong mainStat name', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: { name: 'hp' } },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('rejects mainStat filter when piece has no mainStat', () => {
        const gear = { ...baseGear, mainStat: null } as GearPiece;
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: { name: 'attack' } },
        };
        expect(matchesWishlistEntry(gear, entry)).toBe(false);
    });

    it('matches when all required subStats are present', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { subStats: [{ name: 'crit' }, { name: 'speed' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when a required subStat is missing', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { subStats: [{ name: 'crit' }, { name: 'hp' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('rejects non-empty substat filter when piece has no substats', () => {
        const gear = { ...baseGear, subStats: [] };
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { subStats: [{ name: 'crit' }] },
        };
        expect(matchesWishlistEntry(gear, entry)).toBe(false);
    });

    it('passes empty subStats filter even when piece has no substats', () => {
        const gear = { ...baseGear, subStats: [] };
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { subStats: [] } };
        expect(matchesWishlistEntry(gear, entry)).toBe(true);
    });

    it('fails when any one of multiple filters fails (AND logic)', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { slot: 'weapon', rarity: 'epic' }, // slot passes, rarity fails
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });
});
