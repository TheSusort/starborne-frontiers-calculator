import { describe, expect, it, vi } from 'vitest';
import { createLoadCache } from '../loadCache';

const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(size: number, pinned: string[] = []) {
    const evicted: string[] = [];
    const load = vi.fn(async (key: string) => `model:${key}`);
    const cache = createLoadCache({
        size,
        load,
        isPinned: (k) => pinned.includes(k),
        onEvict: (value, key) => evicted.push(`${key}=${value}`),
    });
    return { cache, load, evicted, pinned };
}

describe('createLoadCache', () => {
    it('loads each key once', async () => {
        const { cache, load } = setup(2);
        await cache.get('a');
        await cache.get('a');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('evicts the least recently used finished entry beyond its size', async () => {
        const { cache, evicted } = setup(2);
        await cache.get('a');
        await cache.get('b');
        await cache.get('a'); // a is now the most recent
        await cache.get('c');
        await settle();
        expect(evicted).toEqual(['b=model:b']);
        expect(cache.keys()).toEqual(['a', 'c']);
    });

    it('never evicts a pinned entry', async () => {
        const { cache, evicted } = setup(1, ['a']);
        await cache.get('a');
        await cache.get('b');
        await cache.get('c');
        await settle();
        expect(evicted).toEqual(['b=model:b']);
        expect(cache.keys()).toEqual(['a', 'c']);
    });

    it('evicts a released pin on the next trim', async () => {
        const { cache, evicted, pinned } = setup(1, ['a']);
        await cache.get('a');
        await cache.get('b');
        await settle();
        expect(evicted).toEqual([]);
        pinned.length = 0;
        cache.trim();
        expect(evicted).toEqual(['a=model:a']);
    });

    it('never evicts an entry still loading', async () => {
        const evicted: string[] = [];
        let finish!: (v: string) => void;
        const cache = createLoadCache<string>({
            size: 1,
            load: (key) =>
                key === 'slow' ? new Promise((r) => (finish = r)) : Promise.resolve(key),
            onEvict: (_, key) => evicted.push(key),
        });
        void cache.get('slow');
        await cache.get('b');
        await settle();
        expect(cache.keys()).toEqual(['slow', 'b']);
        finish('slow');
        await settle();
        // Once finished, the slow entry is the least recently used.
        expect(evicted).toEqual(['slow']);
    });

    it('drops a failed load so the next get retries', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok');
        const cache = createLoadCache<string>({ size: 2, load });
        await expect(cache.get('a')).rejects.toThrow('offline');
        await settle();
        await expect(cache.get('a')).resolves.toBe('ok');
        expect(load).toHaveBeenCalledTimes(2);
    });
});
