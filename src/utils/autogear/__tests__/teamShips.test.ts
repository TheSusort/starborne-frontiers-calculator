import { describe, it, expect } from 'vitest';
import { dedupeShipIds, isSameShipSet, resolveTeamShips } from '../teamShips';
import { Ship } from '../../../types/ship';

/** Minimal Ship stand-in — resolveTeamShips only ever reads identity. */
const makeShip = (id: string): Ship => ({ id, name: id }) as Ship;

describe('dedupeShipIds', () => {
    it('keeps the first occurrence and preserves order', () => {
        expect(dedupeShipIds(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array unchanged', () => {
        expect(dedupeShipIds([])).toEqual([]);
    });
});

describe('resolveTeamShips', () => {
    const fleet = new Map([
        ['a', makeShip('a')],
        ['c', makeShip('c')],
    ]);
    const getShipById = (id: string): Ship | undefined => fleet.get(id);

    it('resolves known ships in stored order', () => {
        const result = resolveTeamShips(['c', 'a'], getShipById);

        expect(result.ships.map((s) => s.id)).toEqual(['c', 'a']);
        expect(result.missingCount).toBe(0);
    });

    it('skips unknown ships and counts them', () => {
        const result = resolveTeamShips(['a', 'gone', 'c', 'also-gone'], getShipById);

        expect(result.ships.map((s) => s.id)).toEqual(['a', 'c']);
        expect(result.missingCount).toBe(2);
    });

    it('dedupes before resolving so a repeated id counts once', () => {
        const result = resolveTeamShips(['a', 'a', 'gone', 'gone'], getShipById);

        expect(result.ships.map((s) => s.id)).toEqual(['a']);
        expect(result.missingCount).toBe(1);
    });

    it('reports every id missing when the fleet has none of them', () => {
        const result = resolveTeamShips(['x', 'y'], getShipById);

        expect(result.ships).toEqual([]);
        expect(result.missingCount).toBe(2);
    });
});

describe('isSameShipSet', () => {
    it('is true for the same ships in a different order', () => {
        expect(isSameShipSet(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    });

    it('is false when a ship was added', () => {
        expect(isSameShipSet(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    });

    it('is false when a ship was removed', () => {
        expect(isSameShipSet(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    });

    it('is false when a ship was swapped for a different one', () => {
        expect(isSameShipSet(['a', 'b'], ['a', 'z'])).toBe(false);
    });

    it('ignores duplicates on either side', () => {
        expect(isSameShipSet(['a', 'a', 'b'], ['b', 'a'])).toBe(true);
    });

    it('is true for two empty lists', () => {
        expect(isSameShipSet([], [])).toBe(true);
    });

    it('is false when only one side is empty', () => {
        expect(isSameShipSet(['a'], [])).toBe(false);
    });
});
