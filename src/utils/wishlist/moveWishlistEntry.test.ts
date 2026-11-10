import { describe, expect, it } from 'vitest';
import { moveWishlistEntry, moveWishlistGroup } from './moveWishlistEntry';

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const ids = (items: { id: string }[]) => items.map((i) => i.id).join('');

describe('moveWishlistEntry', () => {
    it('moves an entry up one place', () => {
        expect(ids(moveWishlistEntry(list, 'b', -1))).toBe('bac');
    });

    it('moves an entry down one place', () => {
        expect(ids(moveWishlistEntry(list, 'b', 1))).toBe('acb');
    });

    it('returns the same array at the ends and for an unknown id', () => {
        expect(moveWishlistEntry(list, 'a', -1)).toBe(list);
        expect(moveWishlistEntry(list, 'c', 1)).toBe(list);
        expect(moveWishlistEntry(list, 'zz', 1)).toBe(list);
    });

    it('does not mutate its input', () => {
        moveWishlistEntry(list, 'a', 1);
        expect(ids(list)).toBe('abc');
    });

    describe('with groups', () => {
        // Display order: X [a, c], Y [b], ungrouped [d].
        const grouped = [
            { id: 'a', group: 'X' },
            { id: 'b', group: 'Y' },
            { id: 'c', group: 'X' },
            { id: 'd' },
        ];

        it('swaps with the neighbouring entry of the same group and normalises', () => {
            expect(ids(moveWishlistEntry(grouped, 'c', -1))).toBe('cabd');
            expect(ids(moveWishlistEntry(grouped, 'a', 1))).toBe('cabd');
        });

        it('does not move an entry out of its group', () => {
            expect(moveWishlistEntry(grouped, 'c', 1)).toBe(grouped);
            expect(moveWishlistEntry(grouped, 'b', -1)).toBe(grouped);
            expect(moveWishlistEntry(grouped, 'd', -1)).toBe(grouped);
        });
    });
});

describe('moveWishlistGroup', () => {
    const grouped = [
        { id: 'a', group: 'X' },
        { id: 'u' },
        { id: 'b', group: 'Y' },
        { id: 'c', group: 'X' },
        { id: 'e', group: 'Z' },
    ];

    it('moves a whole group block past its neighbour, ungrouped last', () => {
        expect(ids(moveWishlistGroup(grouped, 'Y', -1))).toBe('baceu');
        expect(ids(moveWishlistGroup(grouped, 'X', 1))).toBe('baceu');
        expect(ids(moveWishlistGroup(grouped, 'Y', 1))).toBe('acebu');
    });

    it('returns the same array at the ends and for an unknown group', () => {
        expect(moveWishlistGroup(grouped, 'X', -1)).toBe(grouped);
        expect(moveWishlistGroup(grouped, 'Z', 1)).toBe(grouped);
        expect(moveWishlistGroup(grouped, 'nope', 1)).toBe(grouped);
    });
});
