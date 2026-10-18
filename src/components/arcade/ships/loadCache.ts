export interface LoadCacheOptions<T> {
    /** Finished entries kept at once, besides pinned ones. */
    size: number;
    load: (key: string) => Promise<T>;
    /** A pinned entry is never evicted. */
    isPinned?: (key: string) => boolean;
    /** Called with each finished entry the cache evicts. */
    onEvict?: (value: T, key: string) => void;
}

/**
 * Promises by key. Beyond `size` finished, unpinned entries, the least recently used of them are
 * evicted; entries still loading and pinned ones are kept on top of that bound. A failed load is
 * dropped so a later `get` retries.
 */
export function createLoadCache<T>({ size, load, isPinned, onEvict }: LoadCacheOptions<T>) {
    interface Entry {
        promise: Promise<T>;
        done: boolean;
        value?: T;
    }
    /** Most recently used last. */
    const entries = new Map<string, Entry>();

    const trim = (max = size, keep?: string) => {
        const evictable = [...entries].filter(
            ([key, e]) => e.done && key !== keep && !isPinned?.(key)
        );
        const kept = keep !== undefined && entries.get(keep)?.done ? 1 : 0;
        for (const [key, entry] of evictable.slice(
            0,
            Math.max(0, evictable.length - (max - kept))
        )) {
            entries.delete(key);
            onEvict?.(entry.value as T, key);
        }
    };

    return {
        get(key: string): Promise<T> {
            const hit = entries.get(key);
            if (hit) {
                entries.delete(key);
                entries.set(key, hit);
                return hit.promise;
            }
            const entry: Entry = { promise: load(key), done: false };
            entries.set(key, entry);
            entry.promise.then(
                (value) => {
                    if (entries.get(key) !== entry) return;
                    entry.done = true;
                    entry.value = value;
                    trim();
                },
                () => {
                    if (entries.get(key) === entry) entries.delete(key);
                }
            );
            return entry.promise;
        },
        /** Evicts down to `max` finished, unpinned entries (default `size`), counting `keep`'s
         *  entry among them and never evicting it; e.g. after pins were released. */
        trim: (max?: number, keep?: string) => trim(max, keep),
        keys: () => [...entries.keys()],
    };
}
