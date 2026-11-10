import { describe, expect, it } from 'vitest';
import { moveWishlistEntry } from './moveWishlistEntry';

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
});
