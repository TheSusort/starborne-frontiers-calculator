import type { AuthUser } from './types';

/**
 * An anonymous session is an arcade guest, not a signed-in user: it is reported as
 * `guestUserId` and `user` stays null, so sign-in migration, Supabase data loads, the account
 * menu and every other `user`-keyed path treat a guest as signed out.
 */
export function splitAuthUser(u: AuthUser | null): {
    user: AuthUser | null;
    guestUserId: string | null;
} {
    if (!u) return { user: null, guestUserId: null };
    if (u.isAnonymous) return { user: null, guestUserId: u.id };
    return { user: u, guestUserId: null };
}
