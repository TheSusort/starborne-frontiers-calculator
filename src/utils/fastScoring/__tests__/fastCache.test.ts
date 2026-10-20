import { describe, it, expect } from 'vitest';
import { FastCache, buildFastCacheKey } from '../fastCache';

describe('FastCache (two-generation)', () => {
    it('stores and retrieves values', () => {
        const c = new FastCache<number>(3);
        c.set('a', 1);
        c.set('b', 2);
        expect(c.get('a')).toBe(1);
        expect(c.get('b')).toBe(2);
    });

    it('returns undefined for missing keys', () => {
        const c = new FastCache<number>(3);
        expect(c.get('nope')).toBeUndefined();
    });

    it('evicts the least-recently-used entry when full', () => {
        const c = new FastCache<number>(2);
        c.set('a', 1);
        c.set('b', 2);
        c.get('a'); // bump 'a' to most recent
        c.set('c', 3); // should evict 'b'
        expect(c.get('a')).toBe(1);
        expect(c.get('b')).toBeUndefined();
        expect(c.get('c')).toBe(3);
    });

    it('overwriting an existing key refreshes its recency', () => {
        const c = new FastCache<number>(2);
        c.set('a', 1);
        c.set('b', 2);
        c.set('a', 99); // refresh 'a'
        c.set('c', 3); // should evict 'b'
        expect(c.get('a')).toBe(99);
        expect(c.get('b')).toBeUndefined();
    });

    it('never holds more than the limit, however many keys pass through', () => {
        const c = new FastCache<number>(100);
        for (let i = 0; i < 10_000; i++) c.set(`k${i}`, i);
        expect(c.size).toBeLessThanOrEqual(100);
        expect(c.get('k9999')).toBe(9999);
        expect(c.get('k0')).toBeUndefined();
    });

    it('keeps an entry that is read every generation', () => {
        const c = new FastCache<number>(4);
        c.set('hot', 1);
        for (let i = 0; i < 50; i++) {
            c.set(`k${i}`, i);
            expect(c.get('hot')).toBe(1);
        }
    });

    it('a newer write wins over the value in the older generation', () => {
        const c = new FastCache<number>(4);
        c.set('a', 1);
        c.set('b', 2);
        c.set('c', 3); // rotates: 'a' and 'b' move to the older generation
        c.set('a', 99);
        expect(c.get('a')).toBe(99);
    });

    it('tracks size correctly', () => {
        const c = new FastCache<number>(10);
        c.set('a', 1);
        c.set('b', 2);
        expect(c.size).toBe(2);
        c.clear();
        expect(c.size).toBe(0);
    });
});

describe('buildFastCacheKey', () => {
    it('produces a stable, comma-separated key', () => {
        expect(buildFastCacheKey([1, 2, 3])).toBe('1,2,3');
        expect(buildFastCacheKey([0])).toBe('0');
        expect(buildFastCacheKey([])).toBe('');
    });

    it('distinguishes different slot orders', () => {
        expect(buildFastCacheKey([1, 2, 3])).not.toBe(buildFastCacheKey([3, 2, 1]));
    });

    it('represents empty slots with -1', () => {
        expect(buildFastCacheKey([1, -1, 2])).toBe('1,-1,2');
    });
});
