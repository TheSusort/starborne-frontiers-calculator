import { describe, it, expect } from 'vitest';
import { GearPiece } from '../../types/gear';
import { GearSetName } from '../../constants/gearSets';
import { WishlistEntry } from '../../types/wishlist';
import { matchesWishlistEntry } from './matchWishlistEntry';

const baseGear: GearPiece = {
    id: 'g1',
    slot: 'weapon',
    stars: 5,
    rarity: 'epic',
    setBonus: 'Fortitude' as GearSetName,
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

    // ── slot (OR array) ──────────────────────────────────────────────────────
    it('matches when slot is in the filter array', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { slot: ['weapon'] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('matches when slot is one of multiple filter slots', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { slot: ['hull', 'weapon'] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when slot is not in the filter array', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { slot: ['hull'] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('treats empty slot array as wildcard', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { slot: [] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    // ── stars (OR array) ─────────────────────────────────────────────────────
    it('matches when piece stars is in the filter array', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { stars: [5] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('matches when piece stars is one of multiple filter values', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { stars: [4, 5, 6] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when piece stars is not in the filter array', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { stars: [6] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('treats empty stars array as wildcard', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { stars: [] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    // ── rarity (OR array) ────────────────────────────────────────────────────
    it('matches when piece rarity is in the filter array', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { rarity: ['epic'] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('matches when piece rarity is one of multiple filter values', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { rarity: ['epic', 'legendary'] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when piece rarity is not in the filter array', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { rarity: ['legendary'] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('treats empty rarity array as wildcard', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { rarity: [] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    // ── setBonus (OR array) ──────────────────────────────────────────────────
    it('matches when setBonus is in the filter array', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { setBonus: ['Fortitude' as GearSetName] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('matches when setBonus is one of multiple filter sets', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { setBonus: ['Fortitude' as GearSetName, 'Oblivion' as GearSetName] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when setBonus is not in the filter array', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { setBonus: ['Oblivion' as GearSetName] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    // ── mainStat (OR array) ──────────────────────────────────────────────────
    it('matches when mainStat name is in the filter array', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: [{ name: 'attack' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('matches when mainStat is one of multiple filter names', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: [{ name: 'hp' }, { name: 'attack' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when mainStat name is not in filter array', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: [{ name: 'hp' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('rejects mainStat filter when piece has no mainStat', () => {
        const gear = { ...baseGear, mainStat: null } as GearPiece;
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: [{ name: 'attack' }] },
        };
        expect(matchesWishlistEntry(gear, entry)).toBe(false);
    });

    it('treats empty mainStat array as wildcard', () => {
        const entry: WishlistEntry = { id: '1', name: 'test', filters: { mainStat: [] } };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    // ── subStats (AND array, unchanged) ──────────────────────────────────────
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

    // ── subStatsMin ──────────────────────────────────────────────────────────
    it('passes when matched substat count >= subStatsMin', () => {
        // piece has crit + speed; filter lists crit, speed, hp — require 2
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: {
                subStats: [{ name: 'crit' }, { name: 'speed' }, { name: 'hp' }],
                subStatsMin: 2,
            },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects when matched substat count < subStatsMin', () => {
        // piece has crit + speed; filter lists crit, speed, hp — require 3
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: {
                subStats: [{ name: 'crit' }, { name: 'speed' }, { name: 'hp' }],
                subStatsMin: 3,
            },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('defaults to requiring all substats when subStatsMin is not set', () => {
        // piece has crit + speed; filter lists all three — no subStatsMin means all required
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { subStats: [{ name: 'crit' }, { name: 'speed' }, { name: 'hp' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    // ── mainStat with type ───────────────────────────────────────────────────
    it('matches mainStat when type also matches', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: [{ name: 'attack', type: 'flat' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects mainStat when type does not match', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: [{ name: 'attack', type: 'percentage' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('matches mainStat without type against any type (backward compat)', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { mainStat: [{ name: 'attack' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    // ── subStats with type ───────────────────────────────────────────────────
    it('matches subStat when type also matches', () => {
        // baseGear has crit:percentage and speed:flat
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { subStats: [{ name: 'crit', type: 'percentage' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('rejects subStat when type does not match', () => {
        // baseGear has speed:flat — speed:percentage should not match
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { subStats: [{ name: 'speed', type: 'percentage' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });

    it('matches subStat without type against any type (backward compat)', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { subStats: [{ name: 'speed' }] },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    it('correctly counts matches with subStatsMin when types differ', () => {
        // piece has crit:percentage and speed:flat; filter has crit:percentage, speed:percentage, hp:flat — require 1
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: {
                subStats: [
                    { name: 'crit', type: 'percentage' },
                    { name: 'speed', type: 'percentage' }, // type mismatch — won't match
                    { name: 'hp', type: 'flat' }, // name mismatch
                ],
                subStatsMin: 1,
            },
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(true);
    });

    // ── AND logic across filter types ─────────────────────────────────────────
    it('fails when slot matches but rarity does not', () => {
        const entry: WishlistEntry = {
            id: '1',
            name: 'test',
            filters: { slot: ['weapon'], rarity: ['legendary'] }, // slot passes, rarity fails (piece is epic)
        };
        expect(matchesWishlistEntry(baseGear, entry)).toBe(false);
    });
});
