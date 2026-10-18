import { describe, expect, it, vi } from 'vitest';
import { abortError, isAbortError } from '../../idle';
import {
    anySignal,
    cachedPlayerFrames,
    createRequestCache,
    fillFrameGrid,
    PlayerFrames,
    requestPlayerFrames,
    SWEEP_ORDER,
} from '../arcadeSprites';
import { LEVEL_BANK, LEVEL_PITCH_ROW } from '../spritePoses';

const sweepRender = vi.fn();
vi.mock('../arcadeFlags', () => ({
    loadShipSprites: () =>
        Promise.resolve({
            renderChaseSweeps: (...args: unknown[]) => sweepRender(...args),
            disposeSpriteStage: () => {},
        }),
}));

const settle = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
};
const emptyGrid = (): PlayerFrames => [0, 1, 2].map(() => [null, null, null]);
const canvas = () => document.createElement('canvas');

describe('anySignal', () => {
    it('aborts when any source aborts', () => {
        const a = new AbortController();
        const b = new AbortController();
        const both = anySignal(a.signal, b.signal);
        expect(both.aborted).toBe(false);
        b.abort();
        expect(both.aborted).toBe(true);
    });
    it('starts aborted when a source already is', () => {
        const a = new AbortController();
        a.abort();
        expect(anySignal(new AbortController().signal, a.signal).aborted).toBe(true);
    });
});

describe('createRequestCache', () => {
    const live = new AbortController().signal;

    it('dedupes a live request and serves the finished value', async () => {
        const start = vi.fn(async (id: string) => `v:${id}`);
        const cache = createRequestCache(4, () => false, start);
        const a = cache.get('x', live);
        expect(cache.get('x', live)).toBe(a);
        await a;
        await settle();
        expect(cache.cached('x')).toBe('v:x');
        expect(start).toHaveBeenCalledTimes(1);
    });

    it('starts afresh when the earlier request was cancelled', async () => {
        const start = vi.fn(
            (id: string, signal: AbortSignal) =>
                new Promise<string>((resolve, reject) => {
                    signal.addEventListener('abort', () => reject(abortError()));
                    if (!signal.aborted && id === 'done') resolve(id);
                })
        );
        const cache = createRequestCache(4, () => false, start);
        const session = new AbortController();
        const first = cache.get('x', session.signal);
        session.abort();
        await expect(first).rejects.toSatisfy(isAbortError);
        const second = cache.get('x', live);
        expect(second).not.toBe(first);
        expect(start).toHaveBeenCalledTimes(2);
    });

    it('a stale failure never removes a newer request under the same id', async () => {
        let failOld!: (e: Error) => void;
        const start = vi
            .fn()
            .mockImplementationOnce(() => new Promise((_, reject) => (failOld = reject)))
            .mockImplementation(async () => 'new');
        const cache = createRequestCache<string>(1, () => false, start);
        const old = new AbortController();
        void cache.get('x', old.signal).catch(() => {});
        old.abort(); // the old entry is no longer live
        await cache.get('x', live);
        await settle();
        failOld(new Error('late failure'));
        await settle();
        expect(cache.cached('x')).toBe('new');
    });

    it('bounds finished entries, keeping pinned ones', async () => {
        const cache = createRequestCache(
            2,
            (id) => id === 'pin',
            async (id: string) => id
        );
        for (const id of ['pin', 'a', 'b', 'c']) await cache.get(id, live);
        await settle();
        expect(['pin', 'a', 'b', 'c'].map((id) => cache.cached(id))).toEqual([
            'pin',
            null,
            null,
            'c',
        ]);
    });
});

describe('fillFrameGrid', () => {
    const level = (f: PlayerFrames) => f[LEVEL_PITCH_ROW][LEVEL_BANK];

    it('fills every sweep, the level sweep first', async () => {
        const frames = emptyGrid();
        const order: string[] = [];
        const onLevel = vi.fn();
        await fillFrameGrid(
            frames,
            async ({ pitch, bank }) => {
                order.push(`${pitch}${bank}`);
                return [canvas()];
            },
            new AbortController().signal,
            onLevel
        );
        expect(order[0]).toBe(`${LEVEL_PITCH_ROW}${LEVEL_BANK}`);
        expect(order).toHaveLength(SWEEP_ORDER.length);
        expect(frames.every((row) => row.every(Boolean))).toBe(true);
        expect(onLevel).toHaveBeenCalledTimes(1);
    });

    it('skips a failed sweep but fails without the level sweep', async () => {
        const frames = emptyGrid();
        const failing = SWEEP_ORDER[1];
        await fillFrameGrid(
            frames,
            async (ref) => {
                if (ref === failing) throw new Error('lost');
                return [canvas()];
            },
            new AbortController().signal,
            () => {}
        );
        expect(frames[failing.pitch][failing.bank]).toBeNull();
        expect(level(frames)).not.toBeNull();

        await expect(
            fillFrameGrid(
                emptyGrid(),
                async () => {
                    throw new Error('no model');
                },
                new AbortController().signal,
                () => {}
            )
        ).rejects.toThrow('no model');
    });

    it('stops once its signal aborts and resumes where it left off', async () => {
        const frames = emptyGrid();
        const controller = new AbortController();
        let rendered = 0;
        const render = async () => {
            if (++rendered === 3) controller.abort();
            return [canvas()];
        };
        await expect(fillFrameGrid(frames, render, controller.signal, () => {})).rejects.toSatisfy(
            isAbortError
        );
        expect(rendered).toBe(3);
        const again = vi.fn(async () => [canvas()]);
        await fillFrameGrid(frames, again, new AbortController().signal, () => {});
        expect(again).toHaveBeenCalledTimes(SWEEP_ORDER.length - 3);
    });
});

describe('requestPlayerFrames', () => {
    it('resolves at the level sweep, and an aborted fill leaves nothing more to run', async () => {
        sweepRender.mockReset();
        const pending: (() => void)[] = [];
        sweepRender.mockImplementation(
            () => new Promise((resolve) => pending.push(() => resolve([[canvas()]])))
        );
        const session = new AbortController();
        const level = requestPlayerFrames('Fill_1', session.signal);
        await settle();
        expect(sweepRender).toHaveBeenCalledTimes(1);
        pending.shift()!();
        const frames = await level;
        expect(cachedPlayerFrames('Fill_1')).toBe(frames);
        session.abort();
        pending.shift()!();
        await settle();
        // The fill stopped at its next sweep instead of queuing more work.
        expect(sweepRender).toHaveBeenCalledTimes(2);

        // A later request resumes with the sweeps still missing.
        sweepRender.mockImplementation(async () => [[canvas()]]);
        await requestPlayerFrames('Fill_1', new AbortController().signal);
        await settle();
        expect(sweepRender).toHaveBeenCalledTimes(SWEEP_ORDER.length);
        expect(frames.every((row) => row.every(Boolean))).toBe(true);
    });
});
