import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthProvider';

/**
 * Persists a single preference value to localStorage, gated on auth having
 * resolved. Neither the read nor the write may happen before `loading` (from
 * `useAuth`) clears — reading while auth is still resolving can't tell
 * "signed out" apart from "not yet known", and writing then would stomp a
 * previously saved value with `defaultValue`.
 *
 * Once `loading` is false, the stored value is adopted for whichever user id
 * (or "signed out") is current — tracked by `adoptedFor`, compared against
 * the CURRENT identity rather than a one-shot "have we ever hydrated" flag.
 * This matters because auth can resolve to signed-in *after* this hook has
 * already mounted and settled on a value (the initial signed-out state, or a
 * different account) with no remount in between: a one-shot flag would treat
 * that later sign-in as "already hydrated" and overwrite the newly-current
 * user's stored value with whatever was in state, the same destructive write
 * this hook exists to prevent. Comparing identities means ANY transition to
 * a truthy, not previously adopted user id re-reads storage before writing
 * anything.
 *
 * A transition from signed-in back to signed-out is deliberately NOT treated
 * as a fresh "signed-out start" — that would reset to `defaultValue` and
 * then persist it, clobbering the signed-in session's value under the same
 * key. Signed-out is only read as the default on the very first resolve
 * (`adoptedFor.current === undefined`); after that it just persists whatever
 * value is already in state, gated on `user` so a signed-out session never
 * reads someone else's leftover browser-local value. A stored value that
 * fails `isValid` (corrupted, or from a shape this build no longer offers)
 * falls back to `defaultValue` rather than being trusted.
 */
export function usePersistedPreference<T>(
    key: string,
    defaultValue: T,
    isValid: (value: unknown) => value is T
) {
    const { user, loading } = useAuth();
    const [value, setValue] = useState<T>(defaultValue);
    const adoptedFor = useRef<string | null | undefined>(undefined);

    useEffect(() => {
        if (loading) return;
        const identity = user ? user.id : null;

        if (identity !== null && adoptedFor.current !== identity) {
            adoptedFor.current = identity;
            const stored = localStorage.getItem(key);
            let parsed: unknown;
            try {
                parsed = stored === null ? undefined : JSON.parse(stored);
            } catch {
                parsed = undefined;
            }
            setValue(isValid(parsed) ? parsed : defaultValue);
            return;
        }

        if (identity === null && adoptedFor.current === undefined) {
            adoptedFor.current = null;
            setValue(defaultValue);
            return;
        }

        localStorage.setItem(key, JSON.stringify(value));
    }, [key, value, user, loading, defaultValue, isValid]);

    return [value, setValue] as const;
}
