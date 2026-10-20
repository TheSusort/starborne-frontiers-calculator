import { describe, it, expect, vi, afterEach } from 'vitest';
import { yieldToEventLoop } from '../yieldToEventLoop';

describe('yieldToEventLoop', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('resolves without a timer firing when MessageChannel exists', async () => {
        expect(typeof MessageChannel).toBe('function');
        const realSetTimeout = globalThis.setTimeout;
        // Fake timers never fire unless advanced, so resolving here proves no timer was used.
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'setImmediate'] });
        const outcome = await Promise.race([
            yieldToEventLoop().then(() => 'yielded'),
            new Promise((r) => realSetTimeout(() => r('timed out'), 1000)),
        ]);
        expect(outcome).toBe('yielded');
    });

    it('does not resolve synchronously', async () => {
        let resolved = false;
        const pending = yieldToEventLoop().then(() => {
            resolved = true;
        });
        await Promise.resolve();
        expect(resolved).toBe(false);
        await pending;
        expect(resolved).toBe(true);
    });

    it('falls back to a timer where MessageChannel is unavailable', async () => {
        vi.stubGlobal('MessageChannel', undefined);
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        let resolved = false;
        const pending = yieldToEventLoop().then(() => {
            resolved = true;
        });
        await Promise.resolve();
        expect(resolved).toBe(false);
        await vi.advanceTimersByTimeAsync(0);
        await pending;
        expect(resolved).toBe(true);
    });
});
