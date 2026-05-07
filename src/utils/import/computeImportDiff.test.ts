import { describe, it, expect } from 'vitest';
import { GearPiece } from '../../types/gear';
import { WishlistEntry } from '../../types/wishlist';
import { computeImportDiff } from './computeImportDiff';

const makeGear = (overrides: Partial<GearPiece> = {}): GearPiece =>
    ({
        id: 'g1',
        slot: 'weapon',
        stars: 6,
        rarity: 'legendary',
        setBonus: null,
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [],
        shipId: undefined,
        level: 16,
        ...overrides,
    }) as GearPiece;

const entry: WishlistEntry = {
    id: 'w1',
    name: 'Big Attack Weapon',
    filters: { slot: 'weapon', stars: 6, rarity: 'legendary' },
};

describe('computeImportDiff wishlist hits', () => {
    it('returns undefined wishlistHits when no entries arg passed', () => {
        const diff = computeImportDiff([], [], [], [makeGear()]);
        expect(diff.wishlistHits).toBeUndefined();
    });

    it('returns empty array when no newly added gear', () => {
        const gear = makeGear();
        const diff = computeImportDiff([], [gear], [], [gear], null, [entry]);
        expect(diff.wishlistHits).toEqual([]);
    });

    it('detects newly imported gear matching a wishlist entry', () => {
        const gear = makeGear();
        const diff = computeImportDiff([], [], [], [gear], null, [entry]);
        expect(diff.wishlistHits).toHaveLength(1);
        expect(diff.wishlistHits![0].entryId).toBe('w1');
        expect(diff.wishlistHits![0].entryName).toBe('Big Attack Weapon');
        expect(diff.wishlistHits![0].gear.id).toBe('g1');
    });

    it('does not match implants (slot not in GEAR_SLOTS)', () => {
        const implant = makeGear({ id: 'i1', slot: 'implant_major' as GearPiece['slot'] });
        const diff = computeImportDiff([], [], [], [implant], null, [entry]);
        expect(diff.wishlistHits).toEqual([]);
    });

    it('matches one piece against multiple entries', () => {
        const gear = makeGear();
        const entry2: WishlistEntry = { id: 'w2', name: 'Any Weapon', filters: { slot: 'weapon' } };
        const diff = computeImportDiff([], [], [], [gear], null, [entry, entry2]);
        expect(diff.wishlistHits).toHaveLength(2);
    });

    it('does not match when piece fails entry filter', () => {
        const gear = makeGear({ rarity: 'epic' });
        const diff = computeImportDiff([], [], [], [gear], null, [entry]);
        expect(diff.wishlistHits).toEqual([]);
    });
});
