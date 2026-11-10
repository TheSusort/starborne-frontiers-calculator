import { describe, it, expect } from 'vitest';
import { analysisConfigToWishlistDraft, wishlistEntryToAnalysisLink } from './analysisEntryMapping';

const base = { stats: [], statFilterMode: 'AND', gearSets: [], minRarity: 'rare' } as const;

describe('analysisConfigToWishlistDraft', () => {
    it('is null with neither ship nor role', () => {
        expect(analysisConfigToWishlistDraft(base)).toBeNull();
    });

    it('a ship wins over a role', () => {
        const draft = analysisConfigToWishlistDraft({ ...base, shipId: 's1', role: 'ATTACKER' });
        expect(draft?.target).toEqual({ kind: 'ship', shipId: 's1' });
    });

    it('a role alone becomes a role target', () => {
        const draft = analysisConfigToWishlistDraft({ ...base, role: 'DEFENDER' });
        expect(draft?.target).toEqual({ kind: 'role', role: 'DEFENDER' });
    });

    it('AND requires every selected stat', () => {
        const draft = analysisConfigToWishlistDraft({
            ...base,
            role: 'ATTACKER',
            stats: ['attack', 'crit'],
        });
        expect(draft?.filters.subStats).toEqual([{ name: 'attack' }, { name: 'crit' }]);
        expect(draft?.filters.subStatsMin).toBeUndefined();
    });

    it('OR requires at least one selected stat', () => {
        const draft = analysisConfigToWishlistDraft({
            ...base,
            role: 'ATTACKER',
            stats: ['attack', 'crit'],
            statFilterMode: 'OR',
        });
        expect(draft?.filters.subStatsMin).toBe(1);
    });

    it('min rarity becomes the rarity list at and above it', () => {
        const at = (minRarity: 'rare' | 'epic' | 'legendary') =>
            analysisConfigToWishlistDraft({ ...base, role: 'ATTACKER', minRarity })?.filters.rarity;
        expect(at('rare')).toEqual(['rare', 'epic', 'legendary']);
        expect(at('epic')).toEqual(['epic', 'legendary']);
        expect(at('legendary')).toEqual(['legendary']);
    });

    it('gear sets become the set filter', () => {
        const draft = analysisConfigToWishlistDraft({
            ...base,
            role: 'ATTACKER',
            gearSets: ['ATTACK'],
        });
        expect(draft?.filters.setBonus).toEqual(['ATTACK']);
    });
});

describe('wishlistEntryToAnalysisLink', () => {
    it('is null for an untargeted entry', () => {
        expect(wishlistEntryToAnalysisLink({ id: '1', name: 'x', filters: {} })).toBeNull();
    });

    it('carries ship, stats, mode and sets', () => {
        const link = wishlistEntryToAnalysisLink(
            {
                id: '1',
                name: 'x',
                target: { kind: 'ship', shipId: 's1' },
                filters: {
                    subStats: [{ name: 'attack' }, { name: 'crit' }],
                    subStatsMin: 1,
                    setBonus: ['ATTACK'],
                },
            },
            'ATTACKER'
        );
        expect(link).toEqual({
            shipId: 's1',
            role: 'ATTACKER',
            stats: ['attack', 'crit'],
            statFilterMode: 'OR',
            sets: ['ATTACK'],
        });
    });

    it('all-required substats map to AND', () => {
        const link = wishlistEntryToAnalysisLink({
            id: '1',
            name: 'x',
            target: { kind: 'role', role: 'ATTACKER' },
            filters: { subStats: [{ name: 'attack' }, { name: 'crit' }] },
        });
        expect(link?.statFilterMode).toBe('AND');
        expect(link?.role).toBe('ATTACKER');
    });
});
