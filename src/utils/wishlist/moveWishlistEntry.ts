/**
 * Returns a copy of `items` with the item `id` moved by `offset` places (-1 = up, 1 = down).
 * Returns `items` itself when the move would leave the list or `id` is not in it.
 */
export function moveWishlistEntry<T extends { id: string }>(
    items: T[],
    id: string,
    offset: -1 | 1
): T[] {
    const from = items.findIndex((item) => item.id === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= items.length) return items;
    const next = [...items];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
}
