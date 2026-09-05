import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedPreference } from '../usePersistedPreference';

let mockUser: { id: string } | null = null;
let mockLoading = false;
vi.mock('../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: mockUser, loading: mockLoading }),
}));

const KEY = 'persisted-preference-test';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

describe('usePersistedPreference', () => {
    beforeEach(() => {
        localStorage.clear();
        mockUser = null;
        mockLoading = false;
    });

    it('starts at the default when signed out, even with a valid stored value under the bare key', () => {
        localStorage.setItem(KEY, JSON.stringify(false));
        const { result } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));
        expect(result.current[0]).toBe(true);
    });

    it('reads a valid stored value when signed in, from the user-scoped key', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, JSON.stringify(false));
        const { result } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));
        expect(result.current[0]).toBe(false);
    });

    it('falls back to the default when the stored value fails validation', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, JSON.stringify('not-a-boolean'));
        const { result } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));
        expect(result.current[0]).toBe(true);
    });

    it('falls back to the default when the stored value is not valid JSON', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(`${KEY}:user-1`, 'not-json{');
        const { result } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));
        expect(result.current[0]).toBe(true);
    });

    it('persists a change to the user-scoped localStorage key', () => {
        mockUser = { id: 'user-1' };
        const { result } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));
        act(() => result.current[1](false));
        expect(result.current[0]).toBe(false);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('false');
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('never writes to localStorage while signed out', () => {
        const { result } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));
        act(() => result.current[1](false));
        expect(result.current[0]).toBe(false);
        expect(localStorage.length).toBe(0);
    });

    it('does not destroy a saved value when auth has not resolved at mount, and adopts it once auth resolves', () => {
        // Regression for the race where an unresolved `user` at mount was
        // indistinguishable from "signed out", so the effect immediately
        // overwrote a previously saved value with the default.
        localStorage.setItem(`${KEY}:user-1`, JSON.stringify(false));
        mockLoading = true;
        mockUser = null;

        const { result, rerender } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));

        // Auth is still resolving: neither a read nor a write may have happened.
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('false');

        // Auth resolves to a signed-in user.
        mockLoading = false;
        mockUser = { id: 'user-1' };
        rerender();

        expect(result.current[0]).toBe(false);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('false');
    });

    it('does not destroy a saved value when auth resolves to signed-out, after being unresolved at mount', () => {
        // Regression for the `loading` guard specifically: without it, the
        // unresolved-at-mount pass consumes the "first resolve" branch (it
        // can't tell "not yet known" apart from "signed out"), so the real
        // resolve-to-signed-out pass falls through to an unconditional write
        // and stamps the default over the saved value.
        localStorage.setItem(KEY, JSON.stringify(false));
        mockLoading = true;
        mockUser = null;

        const { result, rerender } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));

        // Auth is still resolving: no write yet.
        expect(localStorage.getItem(KEY)).toBe('false');

        // Auth resolves to signed-out (mockUser stays null).
        mockLoading = false;
        rerender();

        expect(result.current[0]).toBe(true);
        expect(localStorage.getItem(KEY)).toBe('false');
    });

    it('does not destroy a saved value on a mid-session sign-in with no remount', () => {
        localStorage.setItem(`${KEY}:user-1`, JSON.stringify(false));
        mockLoading = false;
        mockUser = null;

        const { result, rerender } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));

        // Resolved signed-out: starts at the default, storage untouched.
        expect(result.current[0]).toBe(true);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('false');

        // Signs in, in place.
        mockUser = { id: 'user-1' };
        rerender();

        expect(result.current[0]).toBe(false);
        expect(localStorage.getItem(`${KEY}:user-1`)).toBe('false');
    });

    it('does not leak a value from one account to another on an A-to-B switch', () => {
        // User A signs in and saves a value.
        mockUser = { id: 'user-a' };
        const { result, rerender } = renderHook(() => usePersistedPreference(KEY, true, isBoolean));
        act(() => result.current[1](false));
        expect(localStorage.getItem(`${KEY}:user-a`)).toBe('false');

        // A signs out.
        mockUser = null;
        rerender();

        // B signs in, in the same browser session. B must hydrate from B's
        // own (empty) scoped key, not from whatever A left behind.
        mockUser = { id: 'user-b' };
        rerender();

        expect(result.current[0]).toBe(true);
    });
});
