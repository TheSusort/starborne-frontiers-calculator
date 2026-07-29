import { describe, it, expect } from 'vitest';
import { formationToShipIds } from '../formationToShipIds';
import { ShipPosition } from '../../../types/encounters';

describe('formationToShipIds', () => {
    it('orders by explicit sortOrder ascending', () => {
        const formation: ShipPosition[] = [
            { shipId: 'c', position: 'B2', sortOrder: 3 },
            { shipId: 'a', position: 'T4', sortOrder: 1 },
            { shipId: 'b', position: 'M1', sortOrder: 2 },
        ];

        expect(formationToShipIds(formation)).toEqual(['a', 'b', 'c']);
    });

    it('falls back to board reading order when no sortOrder is set', () => {
        const formation: ShipPosition[] = [
            { shipId: 'bottom', position: 'B1' },
            { shipId: 'mid', position: 'M3' },
            { shipId: 'top', position: 'T2' },
        ];

        expect(formationToShipIds(formation)).toEqual(['top', 'mid', 'bottom']);
    });

    it('puts sorted entries first, then the remainder in board order', () => {
        const formation: ShipPosition[] = [
            { shipId: 'unsorted-top', position: 'T1' },
            { shipId: 'sorted-second', position: 'B4', sortOrder: 2 },
            { shipId: 'unsorted-bottom', position: 'B1' },
            { shipId: 'sorted-first', position: 'M2', sortOrder: 1 },
        ];

        expect(formationToShipIds(formation)).toEqual([
            'sorted-first',
            'sorted-second',
            'unsorted-top',
            'unsorted-bottom',
        ]);
    });

    it('keeps the first occurrence of a duplicated shipId', () => {
        const formation: ShipPosition[] = [
            { shipId: 'dupe', position: 'T1' },
            { shipId: 'other', position: 'T2' },
            { shipId: 'dupe', position: 'M1' },
        ];

        expect(formationToShipIds(formation)).toEqual(['dupe', 'other']);
    });

    it('returns an empty array for an empty formation', () => {
        expect(formationToShipIds([])).toEqual([]);
    });
});
