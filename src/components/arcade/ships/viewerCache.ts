/** Drops the oldest entries of `cache` (insertion order) that `isPinned` does not keep, until at
 *  most `max` remain or only pinned entries are left. */
export function evictOldest<K, V>(
    cache: Map<K, V>,
    max: number,
    isPinned: (key: K) => boolean
): void {
    for (const key of cache.keys()) {
        if (cache.size <= max) return;
        if (!isPinned(key)) cache.delete(key);
    }
}
