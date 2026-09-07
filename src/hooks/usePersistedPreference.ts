import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthProvider';

/**
 * Persists a single preference value to localStorage, gated on auth having
 * resolved. Neither the read nor the write may happen before `loading` (from
 * `useAuth`) clears — reading while auth is still resolving can't tell
 * "signed out" apart from "not yet known", and writing then would stomp a
 * previously saved value with `defaultValue`.
 *
 * The storage key is scoped to the signed-in user's id (`${key}:${user.id}`)
 * so alt-account switching on the same browser never hydrates one account
 * from another's stored value. A signed-out session persists nothing at
 * all — there is no unscoped fallback key to write a shared value into; the
 * in-memory value still works for the rest of that session, it just never
 * reaches disk. This also means a sign-out from a signed-in session leaves
 * the in-memory value as-is (no reset to `defaultValue`) but stops writing
 * it anywhere, so it cannot leak into a shared key either.
 *
 * Once `loading` is false, the stored value is adopted for whichever user id
 * is current — tracked by `adoptedFor`, compared against the CURRENT
 * identity rather than a one-shot "have we ever hydrated" flag. This matters
 * because auth can resolve to signed-in *after* this hook has already
 * mounted and settled on a value (the initial signed-out state, or a
 * different account) with no remount in between: a one-shot flag would treat
 * that later sign-in as "already hydrated" and overwrite the newly-current
 * user's stored value with whatever was in state, the same destructive write
 * this hook exists to prevent. Comparing identities means ANY transition to
 * a truthy, not previously adopted user id re-reads storage before writing
 * anything.
 *
 * Signing out clears the adoption, so signing back in re-reads storage even
 * for the SAME account. Without that, the identity is unchanged across the
 * round trip, the re-read is skipped, and the first write pushes whatever
 * the signed-out session left in memory over the value that account has
 * saved. A stored value that fails `isValid` (corrupted, or from a shape
 * this build no longer offers) falls back to `defaultValue` rather than
 * being trusted.
 *
 * Nothing reads the bare, unscoped `key`. A value stored under one by an
 * older build is therefore orphaned rather than migrated, and that account
 * starts at `defaultValue` once, the same as a first-time user — accepted
 * for a UI preference, not worth migration code.
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
            const stored = localStorage.getItem(`${key}:${identity}`);
            let parsed: unknown;
            try {
                parsed = stored === null ? undefined : JSON.parse(stored);
            } catch {
                parsed = undefined;
            }
            setValue(isValid(parsed) ? parsed : defaultValue);
            return;
        }

        if (identity === null) {
            if (adoptedFor.current === undefined) {
                setValue(defaultValue);
            }
            adoptedFor.current = null;
            // No shared, unauthenticated key to write to — a signed-out
            // session (including one that just signed out of an account)
            // never persists.
            return;
        }

        localStorage.setItem(`${key}:${identity}`, JSON.stringify(value));
    }, [key, value, user, loading, defaultValue, isValid]);

    return [value, setValue] as const;
}
