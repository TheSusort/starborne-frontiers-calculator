/**
 * Bounded memo cache keyed by string (stringified integer tuple) that evicts in two generations:
 * writes go to `current`; when it holds half the limit it becomes `previous` and the old
 * `previous` is dropped whole. A hit in `previous` is promoted into `current`, so recently used
 * entries survive a rotation, which approximates LRU.
 *
 * It never deletes single keys. A V8 `Map` used as a delete-oldest queue leaves deleted slots at
 * the front that `keys().next()` must skip, so per-entry eviction slows every miss once the cache
 * is full; dropping a whole generation costs nothing per entry.
 *
 * We use string keys not BigInt for predictable performance across JS engines.
 * The key is a fixed-length delimited string of small integers, much cheaper
 * than the existing `Object.entries().sort().join()` approach.
 */
export class FastCache<V> {
    private current = new Map<string, V>();
    private previous = new Map<string, V>();
    private readonly generationLimit: number;

    constructor(limit: number) {
        this.generationLimit = Math.max(1, Math.floor(limit / 2));
    }

    get(key: string): V | undefined {
        const v = this.current.get(key);
        if (v !== undefined) return v;
        const old = this.previous.get(key);
        if (old !== undefined) this.set(key, old);
        return old;
    }

    set(key: string, value: V): void {
        if (this.current.size >= this.generationLimit && !this.current.has(key)) {
            this.previous = this.current;
            this.current = new Map();
        }
        this.current.set(key, value);
    }

    /** Entries held across both generations; a promoted key is counted in each. */
    get size(): number {
        return this.current.size + this.previous.size;
    }

    clear(): void {
        this.current.clear();
        this.previous.clear();
    }
}

/**
 * Build a fast cache key from a list of integer ids.
 *
 * Layout: "${id0},${id1},...,${idN}". Empty slots use -1.
 *
 * This is faster than the existing CreateCacheKey because:
 * - No Object.entries() allocation
 * - No Array.sort()
 * - No two-pass string building
 * - Tiny, known-size number->string conversions
 */
export function buildFastCacheKey(ids: readonly number[]): string {
    // Short loop; direct concatenation beats Array.join for small fixed sizes.
    let out = '';
    for (let i = 0; i < ids.length; i++) {
        if (i > 0) out += ',';
        out += ids[i];
    }
    return out;
}
