import { describe, expect, it } from 'vitest';
import { evictOldest } from '../viewerCache';

const cacheOf = (...keys: string[]) => new Map(keys.map((k) => [k, k.toUpperCase()]));

describe('evictOldest', () => {
    it('leaves a cache within its bound alone', () => {
        const cache = cacheOf('a', 'b');
        evictOldest(cache, 2, () => false);
        expect([...cache.keys()]).toEqual(['a', 'b']);
    });
    it('drops the oldest entries first', () => {
        const cache = cacheOf('a', 'b', 'c', 'd');
        evictOldest(cache, 2, () => false);
        expect([...cache.keys()]).toEqual(['c', 'd']);
    });
    it('keeps a pinned entry however old it is', () => {
        const cache = cacheOf('player', 'a', 'b', 'c');
        evictOldest(cache, 2, (k) => k === 'player');
        expect([...cache.keys()]).toEqual(['player', 'c']);
    });
    it('stops when only pinned entries are left', () => {
        const cache = cacheOf('p1', 'p2', 'a');
        evictOldest(cache, 1, (k) => k.startsWith('p'));
        expect([...cache.keys()]).toEqual(['p1', 'p2']);
    });
});
