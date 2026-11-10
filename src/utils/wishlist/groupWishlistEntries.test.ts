import { describe, expect, it } from 'vitest';
import { groupWishlistEntries, insertWishlistEntries } from './groupWishlistEntries';

const ids = (items: { id: string }[]) => items.map((i) => i.id).join('');

describe('groupWishlistEntries', () => {
    it('orders groups by first appearance with ungrouped last', () => {
        const groups = groupWishlistEntries([
            { id: 'u1' },
            { id: 'a', group: 'X' },
            { id: 'b', group: 'Y' },
            { id: 'u2', group: '  ' },
            { id: 'c', group: 'X' },
        ]);
        expect(groups.map((g) => g.name)).toEqual(['X', 'Y', null]);
        expect(groups.map((g) => ids(g.entries))).toEqual(['ac', 'b', 'u1u2']);
    });

    it('has a single ungrouped group when nothing is grouped', () => {
        const single: { id: string; group?: string }[] = [{ id: 'a' }];
        expect(groupWishlistEntries(single).map((g) => g.name)).toEqual([null]);
        expect(groupWishlistEntries([])).toEqual([]);
    });
});

describe('insertWishlistEntries', () => {
    const items = [
        { id: 'u' },
        { id: 'a', group: 'X' },
        { id: 'g1', group: 'X' },
        { id: 'h', group: 'X' },
        { id: 'g2', group: 'X' },
    ];

    it('puts new entries where the first replaced entry stood', () => {
        const added = [
            { id: 'n1', group: 'X' },
            { id: 'n2', group: 'X' },
        ];
        expect(ids(insertWishlistEntries(items, added, ['g1', 'g2']))).toBe('uan1n2h');
    });

    it('puts new entries at the top of their existing group when nothing is replaced', () => {
        expect(ids(insertWishlistEntries(items, [{ id: 'n', group: 'X' }]))).toBe('unag1hg2');
    });

    it('puts new entries at the top otherwise', () => {
        expect(ids(insertWishlistEntries(items, [{ id: 'n', group: 'New' }]))).toBe('nuag1hg2');
        expect(ids(insertWishlistEntries(items, [{ id: 'n' }]))).toBe('nuag1hg2');
    });

    it('does not mutate its input', () => {
        insertWishlistEntries(items, [{ id: 'n' }], ['a']);
        expect(ids(items)).toBe('uag1hg2');
    });
});
