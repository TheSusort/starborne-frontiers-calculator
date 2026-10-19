import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createIdleQueue,
    DEFAULT_UNIT_MS,
    FALLBACK_SLICE_MS,
    IdleDeadline,
    isAbortError,
    whenIdle,
} from '../idle';

type IdleCallback = (deadline: IdleDeadline) => void;

const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

/**
 * Installs a `requestIdleCallback` whose callbacks run only when `flush` is called. Each flush is
 * one idle period whose `timeRemaining()` is the `remaining` value at the moment it is read.
 */
function stubIdle() {
    const pending: { cb: IdleCallback; timeout?: number }[] = [];
    const clock = { remaining: 50 };
    vi.stubGlobal('requestIdleCallback', (cb: IdleCallback, opts?: { timeout?: number }) => {
        pending.push({ cb, timeout: opts?.timeout });
        return pending.length;
    });
    const deadline: IdleDeadline = { timeRemaining: () => clock.remaining };
    return {
        pending,
        clock,
        /** Runs the callbacks registered so far as one idle period with `remaining` ms left. */
        flush: async (remaining = 50) => {
            await settle();
            clock.remaining = remaining;
            for (const { cb } of pending.splice(0)) cb(deadline);
            await settle();
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('whenIdle', () => {
    it('waits for an idle callback, passing its timeout and deadline', async () => {
        const idle = stubIdle();
        let deadline: IdleDeadline | null = null;
        void whenIdle(250).then((d) => (deadline = d));
        await Promise.resolve();
        expect(deadline).toBeNull();
        expect(idle.pending.map((p) => p.timeout)).toEqual([250]);
        await idle.flush(12);
        expect(deadline!.timeRemaining()).toBe(12);
    });

    it('without requestIdleCallback, starts after the next frame with a short deadline', async () => {
        vi.stubGlobal('requestIdleCallback', undefined);
        const frames: FrameRequestCallback[] = [];
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
        let deadline: IdleDeadline | null = null;
        void whenIdle().then((d) => (deadline = d));
        await vi.advanceTimersByTimeAsync(50);
        expect(deadline).toBeNull();
        frames.splice(0).forEach((cb) => cb(0));
        await vi.advanceTimersByTimeAsync(0);
        expect(deadline!.timeRemaining()).toBeGreaterThan(0);
        expect(deadline!.timeRemaining()).toBeLessThanOrEqual(FALLBACK_SLICE_MS);
        await vi.advanceTimersByTimeAsync(FALLBACK_SLICE_MS);
        expect(deadline!.timeRemaining()).toBe(0);
    });

    it('without requestIdleCallback or frames (a hidden tab), resolves at the timeout', async () => {
        vi.stubGlobal('requestIdleCallback', undefined);
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', () => 0);
        let done = false;
        void whenIdle(300).then(() => (done = true));
        await vi.advanceTimersByTimeAsync(299);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
    });
});

describe('createIdleQueue', () => {
    it('runs queued tasks in order, several in one period while it has time', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const ran: string[] = [];
        const all = Promise.all(['a', 'b', 'c'].map((x) => queue(() => ran.push(x))));
        expect(ran).toEqual([]);
        await idle.flush(30);
        expect(ran).toEqual(['a', 'b', 'c']);
        await all;
    });

    it('yields to the next period when the time left is under a unit', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const ran: string[] = [];
        void queue(() => {
            ran.push('a');
            idle.clock.remaining = DEFAULT_UNIT_MS - 1;
        });
        void queue(() => ran.push('b'));
        await idle.flush(30);
        expect(ran).toEqual(['a']);
        await idle.flush(30);
        expect(ran).toEqual(['a', 'b']);
    });

    it('splits a task into units and stops a period when its time runs out', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const units: number[] = [];
        const done = queue(async (slice) => {
            for (let i = 0; i < 6; i++) {
                if (i > 0) await slice.next(5);
                units.push(i);
                idle.clock.remaining -= 5;
            }
            return 'done';
        });
        await idle.flush(12); // 12 → 7 → 2: two units fit
        expect(units).toEqual([0, 1]);
        await idle.flush(16); // 16 → 11 → 6 → 1: three units fit
        expect(units).toEqual([0, 1, 2, 3, 4]);
        await idle.flush(16);
        expect(units).toEqual([0, 1, 2, 3, 4, 5]);
        await expect(done).resolves.toBe('done');
    });

    it('runs one unit per period on a page that is never idle', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const units: number[] = [];
        void queue(async (slice) => {
            for (let i = 0; i < 3; i++) {
                if (i > 0) await slice.next();
                units.push(i);
            }
        });
        // A timed-out idle callback reports no time left.
        await idle.flush(0);
        expect(units).toEqual([0]);
        await idle.flush(0);
        expect(units).toEqual([0, 1]);
        await idle.flush(0);
        expect(units).toEqual([0, 1, 2]);
    });

    it('waits for an async task to finish before starting the next', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        let finish!: () => void;
        const first = queue(() => new Promise<void>((resolve) => (finish = resolve)));
        const second = queue(() => 'second');
        await idle.flush();
        await idle.flush();
        expect(idle.pending).toHaveLength(0);
        finish();
        await first;
        await idle.flush();
        await expect(second).resolves.toBe('second');
    });

    it('keeps going after a task throws', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const failed = queue(() => {
            throw new Error('lost context');
        });
        const next = queue(() => 'next');
        await idle.flush();
        await expect(failed).rejects.toThrow('lost context');
        await idle.flush();
        await expect(next).resolves.toBe('next');
    });

    it('drops a queued task when its signal aborts, without running it', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const controller = new AbortController();
        const task = vi.fn();
        const dropped = queue(task, { signal: controller.signal });
        const kept = queue(() => 'kept');
        controller.abort();
        await expect(dropped).rejects.toSatisfy(isAbortError);
        await idle.flush();
        await expect(kept).resolves.toBe('kept');
        expect(task).not.toHaveBeenCalled();
    });

    it('rejects at once when the signal has already aborted', async () => {
        stubIdle();
        const controller = new AbortController();
        controller.abort();
        await expect(createIdleQueue()(() => 1, { signal: controller.signal })).rejects.toSatisfy(
            isAbortError
        );
    });

    it('stops a running task at its next unit once its signal aborts', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const controller = new AbortController();
        const units: number[] = [];
        const run = queue(
            async (slice) => {
                for (let i = 0; i < 3; i++) {
                    if (i > 0) await slice.next();
                    units.push(i);
                    idle.clock.remaining = 0;
                }
            },
            { signal: controller.signal }
        );
        await idle.flush(10);
        expect(units).toEqual([0]);
        controller.abort();
        await idle.flush(10);
        await expect(run).rejects.toSatisfy(isAbortError);
        expect(units).toEqual([0]);
    });

    it('holds heavy tasks back while held, running lighter ones behind them', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const ran: string[] = [];
        queue.hold(true);
        void queue(() => ran.push('heavy'), { heavy: () => true });
        void queue(() => ran.push('light'));
        await idle.flush();
        await idle.flush();
        expect(ran).toEqual(['light']);
        queue.hold(false);
        await idle.flush();
        expect(ran).toEqual(['light', 'heavy']);
    });
});
