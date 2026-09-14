import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStatSweep } from '../useStatSweep';
import { sweepBoardInput } from '../../utils/simulator/__testutils__/sweepBoardFixture';

const buildInput = sweepBoardInput;

const args = {
    target: { side: 'player', position: 'T1' } as const,
    stat: 'speed' as const,
    from: 100,
    to: 120,
    step: 10,
    resolved: 100,
    baseSeed: 7,
    count: 2,
};

// Captures the AbortSignal the hook hands to the sweep runner, so the unmount test can observe
// cleanup directly rather than inferring it.
const captured = vi.hoisted(() => ({ signal: undefined as AbortSignal | undefined }));

vi.mock('../../utils/simulator/statSweep', async () => {
    const actual = await vi.importActual<typeof import('../../utils/simulator/statSweep')>(
        '../../utils/simulator/statSweep'
    );
    return {
        ...actual,
        runStatSweepAsync: (...callArgs: Parameters<typeof actual.runStatSweepAsync>) => {
            captured.signal = callArgs[6]?.signal;
            return actual.runStatSweepAsync(...callArgs);
        },
    };
});

describe('useStatSweep', () => {
    it('populates one point per step', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        await waitFor(() => expect(result.current.isSweeping).toBe(false));
        expect(result.current.points?.map((p) => p.value)).toEqual([100, 110, 120]);
        expect(result.current.stat).toBe('speed');
        expect(result.current.error).toBeNull();
    });

    it('reports an invalid range as an error instead of throwing', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep({ ...args, step: 0 }));
        expect(result.current.error).toMatch(/step/i);
        expect(result.current.points).toBeNull();
        expect(result.current.isSweeping).toBe(false);
    });

    it('is sweeping while a sweep is in flight and not after', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        expect(result.current.isSweeping).toBe(true);
        await waitFor(() => expect(result.current.isSweeping).toBe(false));
    });

    it('leaves the previous points in place when a sweep is cancelled', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        await waitFor(() => expect(result.current.points).not.toBeNull());
        const first = result.current.points;

        act(() => result.current.runSweep({ ...args, to: 200, step: 10 }));
        act(() => result.current.cancelSweep());
        await waitFor(() => expect(result.current.isSweeping).toBe(false));
        // A cancelled sweep produced nothing, so it must not blank the result being read.
        expect(result.current.points).toBe(first);
    });

    it('aborts the sweep in flight when it unmounts', async () => {
        // React no longer warns about a post-unmount state write, so a console.error spy here
        // would pass whether or not the hook cleans up. Observe the signal directly instead.
        const { result, unmount } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep({ ...args, to: 200, step: 10, count: 5 }));
        const signal = captured.signal;
        expect(signal?.aborted).toBe(false);
        unmount();
        expect(signal?.aborted).toBe(true);
    });

    it('clears every field', async () => {
        const { result } = renderHook(() => useStatSweep({ buildInput }));
        act(() => result.current.runSweep(args));
        await waitFor(() => expect(result.current.points).not.toBeNull());
        act(() => result.current.clearSweep());
        expect(result.current.points).toBeNull();
        expect(result.current.stat).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.progress).toBeNull();
    });
});
