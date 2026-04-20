/**
 * Tiny LRU cache keyed by string (stringified integer tuple). Map insertion
 * order in JS is LRU-friendly: on hit we delete+reinsert; on overflow we
 * delete the oldest (first) key.
 *
 * We use string keys not BigInt for predictable performance across JS engines.
 * The key is a fixed-length delimited string of small integers, much cheaper
 * than the existing `Object.entries().sort().join()` approach.
 */
export class FastCache<V> {
    private readonly store = new Map<string, V>();
    constructor(private readonly limit: number) {}

    get(key: string): V | undefined {
        const v = this.store.get(key);
        if (v === undefined) return undefined;
        // Mark as most recently used
        this.store.delete(key);
        this.store.set(key, v);
        return v;
    }

    set(key: string, value: V): void {
        if (this.store.has(key)) {
            this.store.delete(key);
        } else if (this.store.size >= this.limit) {
            const oldest = this.store.keys().next().value;
            if (oldest !== undefined) this.store.delete(oldest);
        }
        this.store.set(key, value);
    }

    get size(): number {
        return this.store.size;
    }

    clear(): void {
        this.store.clear();
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
