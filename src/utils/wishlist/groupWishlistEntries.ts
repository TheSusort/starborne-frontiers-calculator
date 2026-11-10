export interface WishlistGroup<T> {
    /** The group name; `null` for the ungrouped entries. */
    name: string | null;
    entries: T[];
}

/** An entry's group name, or `null` when it has none (blank counts as none). */
export const wishlistGroupName = (entry: { group?: string }): string | null =>
    entry.group?.trim() || null;

/**
 * The display order of a wishlist: named groups in the order their first entry appears in
 * `entries`, each holding its entries in array order, then the ungrouped entries last. Every
 * group-aware reorder (`moveWishlistEntry`, `moveWishlistGroup`) and insert
 * (`insertWishlistEntries`) works on this order and writes it back flattened.
 */
export function groupWishlistEntries<T extends { group?: string }>(
    entries: readonly T[]
): WishlistGroup<T>[] {
    const named = new Map<string, T[]>();
    const ungrouped: T[] = [];
    for (const entry of entries) {
        const name = wishlistGroupName(entry);
        if (name === null) {
            ungrouped.push(entry);
        } else {
            const list = named.get(name);
            if (list) list.push(entry);
            else named.set(name, [entry]);
        }
    }
    const groups: WishlistGroup<T>[] = [...named].map(([name, list]) => ({
        name,
        entries: list,
    }));
    if (ungrouped.length > 0) groups.push({ name: null, entries: ungrouped });
    return groups;
}

export const flattenWishlistGroups = <T>(groups: readonly WishlistGroup<T>[]): T[] =>
    groups.flatMap((g) => g.entries);

/**
 * `items` with `replaceIds` removed and `added` inserted as one block: where the first replaced
 * item stood; else, when the first added entry's group already exists, at the top of that
 * group; else at the top of the list.
 */
export function insertWishlistEntries<T extends { id: string; group?: string }>(
    items: readonly T[],
    added: readonly T[],
    replaceIds: readonly string[] = []
): T[] {
    const replace = new Set(replaceIds);
    const firstReplaced = items.findIndex((item) => replace.has(item.id));
    const kept = items.filter((item) => !replace.has(item.id));
    let at = 0;
    if (firstReplaced >= 0) {
        at = items.slice(0, firstReplaced).filter((item) => !replace.has(item.id)).length;
    } else if (added.length > 0) {
        const group = wishlistGroupName(added[0]);
        const groupStart =
            group === null ? -1 : kept.findIndex((item) => wishlistGroupName(item) === group);
        if (groupStart >= 0) at = groupStart;
    }
    return [...kept.slice(0, at), ...added, ...kept.slice(at)];
}
