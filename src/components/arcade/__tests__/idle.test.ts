import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdleQueue, whenIdle } from '../idle';

type IdleCallback = () => void;

const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Installs a `requestIdleCallback` whose callbacks run only when `flush` is called. */
function stubIdle() {
    const pending: { cb: IdleCallback; timeout?: number }[] = [];
    vi.stubGlobal('requestIdleCallback', (cb: IdleCallback, opts?: { timeout?: number }) => {
        pending.push({ cb, timeout: opts?.timeout });
        return pending.length;
    });
    return {
        pending,
        /** Runs the callbacks registered so far, as one idle period. */
        flush: async () => {
            // Promise continuations run first, so requests queued behind them are registered.
            await settle();
            for (const { cb } of pending.splice(0)) cb();
            await settle();
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('whenIdle', () => {
    it('waits for an idle callback, passing its timeout', async () => {
        const idle = stubIdle();
        let done = false;
        void whenIdle(250).then(() => (done = true));
        await Promise.resolve();
        expect(done).toBe(false);
        expect(idle.pending.map((p) => p.timeout)).toEqual([250]);
        await idle.flush();
        expect(done).toBe(true);
    });
    it('falls back to a timer without requestIdleCallback', async () => {
        vi.stubGlobal('requestIdleCallback', undefined);
        vi.useFakeTimers();
        let done = false;
        void whenIdle().then(() => (done = true));
        await Promise.resolve();
        expect(done).toBe(false);
        await vi.runAllTimersAsync();
        expect(done).toBe(true);
    });
});

describe('createIdleQueue', () => {
    it('runs one task per idle period, in order', async () => {
        const idle = stubIdle();
        const queue = createIdleQueue();
        const ran: string[] = [];
        const a = queue(() => ran.push('a'));
        const b = queue(() => ran.push('b'));
        const c = queue(() => ran.push('c'));
        await idle.flush();
        expect(ran).toEqual(['a']);
        await idle.flush();
        expect(ran).toEqual(['a', 'b']);
        await idle.flush();
        expect(ran).toEqual(['a', 'b', 'c']);
        await Promise.all([a, b, c]);
    });
    it('waits for an async task to finish before asking for the next idle period', async () => {
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
});
