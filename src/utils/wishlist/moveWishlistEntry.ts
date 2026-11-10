import {
    flattenWishlistGroups,
    groupWishlistEntries,
    wishlistGroupName,
} from './groupWishlistEntries';

/**
 * Moves the item `id` one place up (-1) or down (1) within its group, swapping it with the
 * neighbouring entry of the same group in display order (`groupWishlistEntries`). The result is
 * the display order flattened, so each group's entries end up contiguous.
 * Returns `items` itself when the move would leave the group or `id` is not in it.
 */
export function moveWishlistEntry<T extends { id: string; group?: string }>(
    items: T[],
    id: string,
    offset: -1 | 1
): T[] {
    const item = items.find((i) => i.id === id);
    if (!item) return items;
    const groups = groupWishlistEntries(items);
    const group = groups.find((g) => g.name === wishlistGroupName(item))!;
    const from = group.entries.indexOf(item);
    const to = from + offset;
    if (to < 0 || to >= group.entries.length) return items;
    const entries = [...group.entries];
    [entries[from], entries[to]] = [entries[to], entries[from]];
    return flattenWishlistGroups(groups.map((g) => (g === group ? { ...g, entries } : g)));
}

/**
 * Moves the named group's whole block one group up (-1) or down (1) in display order. The
 * ungrouped entries always render last and never trade places with a named group.
 * Returns `items` itself when the move would leave the named groups or the group is unknown.
 */
export function moveWishlistGroup<T extends { group?: string }>(
    items: T[],
    group: string,
    offset: -1 | 1
): T[] {
    const groups = groupWishlistEntries(items);
    const named = groups.filter((g) => g.name !== null);
    const from = named.findIndex((g) => g.name === group);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= named.length) return items;
    [named[from], named[to]] = [named[to], named[from]];
    return flattenWishlistGroups([...named, ...groups.filter((g) => g.name === null)]);
}
