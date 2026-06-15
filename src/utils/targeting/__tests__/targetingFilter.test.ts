import { describe, it, expect } from 'vitest';
import {
    getShipTargetingFacets,
    matchesTargetingFilters,
    buildTargetingSearchText,
} from '../targetingFilter';
import { Ship } from '../../../types/ship';

// Minimal Ship factory — only targeting-relevant fields matter for the helper.
const makeShip = (overrides: Partial<Ship>): Ship =>
    ({
        id: '1',
        name: 'Test',
        rarity: 'legendary',
        faction: 'terran',
        type: 'attacker',
        baseStats: {},
        stats: {},
        equipment: {},
        ...overrides,
    }) as Ship;

describe('getShipTargetingFacets', () => {
    it('extracts active selection + shape', () => {
        const ship = makeShip({ activeTarget: 'front', activePattern: 'Pattern-Cone-Range-1' });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections).toEqual(['front']);
        expect(facets.shapes).toEqual(['cone']);
    });

    it('unions active + charged, deduped', () => {
        const ship = makeShip({
            activeTarget: 'front',
            activePattern: 'Pattern-Cone-Range-1',
            chargedTarget: 'all',
            chargedPattern: 'Pattern-Circle-Range-1',
            chargeSkillCharge: 3,
        });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections.sort()).toEqual(['all', 'front']);
        expect(facets.shapes.sort()).toEqual(['circle', 'cone']);
    });

    it('does not double-count when charged inherits active', () => {
        const ship = makeShip({
            activeTarget: 'front',
            activePattern: 'Pattern-Cone-Range-1',
            chargeSkillCharge: 3, // charged inherits active per parseShipTargeting
        });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections).toEqual(['front']);
        expect(facets.shapes).toEqual(['cone']);
    });

    it('returns empty facets for a ship with no targeting', () => {
        const facets = getShipTargetingFacets(makeShip({}));
        expect(facets.selections).toEqual([]);
        expect(facets.shapes).toEqual([]);
    });

    it('handles ally/support selection', () => {
        const ship = makeShip({ activeTarget: 'allies', activePattern: 'Pattern-Base-Support' });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections).toEqual(['team']);
    });
});

describe('matchesTargetingFilters', () => {
    const ship = makeShip({
        activeTarget: 'front',
        activePattern: 'Pattern-Cone-Range-1',
    });

    it('matches when no filters set', () => {
        expect(matchesTargetingFilters(ship, {})).toBe(true);
        expect(matchesTargetingFilters(ship, { selections: [], shapes: [] })).toBe(true);
    });

    it('OR within an axis', () => {
        expect(matchesTargetingFilters(ship, { selections: ['front', 'back'] })).toBe(true);
        expect(matchesTargetingFilters(ship, { selections: ['back'] })).toBe(false);
    });

    it('AND across axes', () => {
        expect(matchesTargetingFilters(ship, { selections: ['front'], shapes: ['cone'] })).toBe(
            true
        );
        expect(matchesTargetingFilters(ship, { selections: ['front'], shapes: ['circle'] })).toBe(
            false
        );
    });

    it('no-targeting ship fails any non-empty filter', () => {
        expect(matchesTargetingFilters(makeShip({}), { shapes: ['cone'] })).toBe(false);
    });
});

describe('buildTargetingSearchText', () => {
    it('includes selection label, shape label, and raw strings, lowercased', () => {
        const ship = makeShip({ activeTarget: 'front', activePattern: 'Pattern-Cone-Range-1' });
        const text = buildTargetingSearchText(ship);
        expect(text).toContain('front');
        expect(text).toContain('cone');
        expect(text).toContain('pattern-cone-range-1');
    });

    it('includes the shape label even when it differs from the raw token', () => {
        const ship = makeShip({ activeTarget: 'allies', activePattern: 'Pattern-Base-Support' });
        const text = buildTargetingSearchText(ship);
        expect(text).toContain('single target'); // proves the PATTERN_SHAPES label path
    });

    it('includes both active and charged shape labels when they differ', () => {
        const ship = makeShip({
            activeTarget: 'front',
            activePattern: 'Pattern-Cone-Range-1',
            chargedTarget: 'all',
            chargedPattern: 'Pattern-Circle-Range-1',
            chargeSkillCharge: 3,
        });
        const text = buildTargetingSearchText(ship);
        expect(text).toContain('cone');
        expect(text).toContain('circle');
    });

    it('is empty for a ship with no targeting', () => {
        expect(buildTargetingSearchText(makeShip({}))).toBe('');
    });
});
