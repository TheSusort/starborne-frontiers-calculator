import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    usePersistedCoverageSampleSize,
    COVERAGE_SAMPLE_SIZE_STEPS,
} from '../usePersistedCoverageSampleSize';
import { COVERAGE_SAMPLE_SIZE } from '../../utils/gear/roleSlotCoverage';

let mockUser: { id: string } | null = null;
let mockLoading = false;
vi.mock('../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: mockUser, loading: mockLoading }),
}));

const KEY = 'gear-coverage-sample-size-test';

describe('usePersistedCoverageSampleSize', () => {
    beforeEach(() => {
        localStorage.clear();
        mockUser = null;
        mockLoading = false;
    });

    it('starts at the default when signed out, even with a valid stored value', () => {
        // The read is user-gated, matching usePersistedViewMode exactly: a
        // signed-out session must not pick up a leftover browser-local value.
        localStorage.setItem(KEY, '100');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('starts at the default when signed in with nothing stored', () => {
        mockUser = { id: 'user-1' };
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('reads a valid stored value when signed in', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, '100');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(100);
    });

    it('falls back to the default when the stored value is not one of the allowed steps', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, '37');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('falls back to the default when the stored value is not a number at all', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, 'not-a-number');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('persists a change to the user-scoped localStorage key', () => {
        mockUser = { id: 'user-1' };
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        act(() => result.current[1](200));
        expect(result.current[0]).toBe(200);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('200');
    });

    it('offers exactly the fixed steps 10, 20, 50, 100, 200', () => {
        expect(COVERAGE_SAMPLE_SIZE_STEPS).toEqual([10, 20, 50, 100, 200]);
    });

    it('does not destroy a saved value when auth has not resolved at mount, and adopts it once auth resolves', () => {
        // Regression for the race where an unresolved `user` at mount was
        // indistinguishable from "signed out", so the effect immediately
        // overwrote a previously saved value (e.g. 100) with the default.
        localStorage.setItem(`${KEY}:user-1`, '100');
        mockLoading = true;
        mockUser = null;

        const { result, rerender } = renderHook(() => usePersistedCoverageSampleSize(KEY));

        // Auth is still resolving: neither a read nor a write may have happened.
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('100');

        // Auth resolves to a signed-in user.
        mockLoading = false;
        mockUser = { id: 'user-1' };
        rerender();

        expect(result.current[0]).toBe(100);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('100');
    });

    it('does not destroy a saved value on a mid-session sign-in with no remount', () => {
        // A second, distinct race from the mount-timing one above: auth can
        // resolve to signed-out immediately (loading already false), settle
        // this hook on the default, and only later have the user actually
        // sign in in-place -- no unmount/remount, so a one-shot "have we
        // hydrated yet" flag would treat the sign-in as already-hydrated and
        // overwrite the newly-current user's stored value with the
        // signed-out default still sitting in state.
        localStorage.setItem(`${KEY}:user-1`, '100');
        mockLoading = false;
        mockUser = null;

        const { result, rerender } = renderHook(() => usePersistedCoverageSampleSize(KEY));

        // Resolved signed-out: starts at the default, storage untouched.
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('100');

        // Signs in, in place.
        mockUser = { id: 'user-1' };
        rerender();

        expect(result.current[0]).toBe(100);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('100');
    });
});
