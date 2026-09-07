import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedViewMode } from '../usePersistedViewMode';

let mockUser: { id: string } | null = null;
let mockLoading = false;
vi.mock('../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: mockUser, loading: mockLoading }),
}));

const KEY = 'ship-inventory-view-mode-test';

describe('usePersistedViewMode', () => {
    beforeEach(() => {
        localStorage.clear();
        mockUser = null;
        mockLoading = false;
    });

    it('starts at the default when signed out, even with a valid stored value', () => {
        localStorage.setItem(`${KEY}:user-1`, '"image"');
        const { result } = renderHook(() => usePersistedViewMode(KEY));
        expect(result.current[0]).toBe('list');
    });

    it('starts at the default when signed in with nothing stored', () => {
        mockUser = { id: 'user-1' };
        const { result } = renderHook(() => usePersistedViewMode(KEY));
        expect(result.current[0]).toBe('list');
    });

    it('reads a valid stored value when signed in', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, '"image"');
        const { result } = renderHook(() => usePersistedViewMode(KEY));
        expect(result.current[0]).toBe('image');
    });

    it('falls back to the default when the stored value is not a valid ViewMode', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, '"grid"');
        const { result } = renderHook(() => usePersistedViewMode(KEY));
        expect(result.current[0]).toBe('list');
    });

    it('falls back to the default when the stored value is not valid JSON', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, 'image');
        const { result } = renderHook(() => usePersistedViewMode(KEY));
        expect(result.current[0]).toBe('list');
    });

    it('persists a change to the user-scoped localStorage key', () => {
        mockUser = { id: 'user-1' };
        const { result } = renderHook(() => usePersistedViewMode(KEY));
        act(() => result.current[1]('image'));
        expect(result.current[0]).toBe('image');
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('"image"');
    });

    it('does not destroy a saved value when auth has not resolved at mount, and adopts it once auth resolves', () => {
        // Regression for the race where an unresolved `user` at mount was
        // indistinguishable from "signed out", so the effect immediately
        // overwrote a previously saved value (e.g. 'image') with the default.
        localStorage.setItem(`${KEY}:user-1`, '"image"');
        mockLoading = true;
        mockUser = null;

        const { result, rerender } = renderHook(() => usePersistedViewMode(KEY));

        // Auth is still resolving: neither a read nor a write may have happened.
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('"image"');

        // Auth resolves to a signed-in user.
        mockLoading = false;
        mockUser = { id: 'user-1' };
        rerender();

        expect(result.current[0]).toBe('image');
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('"image"');
    });

    it('does not destroy a saved value on a mid-session sign-in with no remount', () => {
        // A second, distinct race from the mount-timing one above: auth can
        // resolve to signed-out immediately (loading already false), settle
        // this hook on the default, and only later have the user actually
        // sign in in-place -- no unmount/remount, so a one-shot "have we
        // hydrated yet" flag would treat the sign-in as already-hydrated and
        // overwrite the newly-current user's stored value with the
        // signed-out default still sitting in state.
        localStorage.setItem(`${KEY}:user-1`, '"image"');
        mockLoading = false;
        mockUser = null;

        const { result, rerender } = renderHook(() => usePersistedViewMode(KEY));

        // Resolved signed-out: starts at the default, storage untouched.
        expect(result.current[0]).toBe('list');
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('"image"');

        // Signs in, in place.
        mockUser = { id: 'user-1' };
        rerender();

        expect(result.current[0]).toBe('image');
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('"image"');
    });
});
