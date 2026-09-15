import { AuthUser, listAuthUsers, selectAll } from './supabaseRest';

/**
 * Who counts as inactive, and what deleting them would remove.
 *
 * Shared by the dry-run report and the deletion script so both read the same
 * cohort. `public.users.id` IS the `auth.users.id` for a main account (see
 * `has_profile_access`: `id = auth.uid()`); an alt has a generated id of its own
 * plus `owner_auth_user_id` pointing at its owner's auth id, and no auth row.
 */

export const DEFAULT_IDLE_DAYS = 180;

export type Profile = {
    id: string;
    email: string | null;
    username: string | null;
    updated_at: string | null;
    created_at: string | null;
    owner_auth_user_id: string | null;
    is_admin: boolean | null;
};

export type Account = {
    profile: Profile;
    isAlt: boolean;
    lastSeen: Date | null;
    /** Which source produced `lastSeen` — so a surprising date can be traced. */
    lastSeenSource: string;
    idleDays: number | null;
};

const maxSeen = (
    candidates: Array<[string, string | null | undefined]>
): { at: Date | null; source: string } => {
    let at: Date | null = null;
    let source = 'never';
    for (const [label, raw] of candidates) {
        if (!raw) continue;
        const when = new Date(raw);
        if (Number.isNaN(when.getTime())) continue;
        if (!at || when > at) {
            at = when;
            source = label;
        }
    }
    return { at, source };
};

export const loadAccounts = async (now: Date): Promise<Account[]> => {
    const [profiles, authUsers, activity, heartbeats] = await Promise.all([
        selectAll<Profile>(
            'users',
            'select=id,email,username,updated_at,created_at,owner_auth_user_id,is_admin'
        ),
        listAuthUsers(),
        selectAll<{ user_id: string; activity_date: string }>(
            'user_activity_log',
            'select=user_id,activity_date'
        ),
        selectAll<{ user_id: string; last_seen: string }>('heartbeats', 'select=user_id,last_seen'),
    ]);

    const authById = new Map<string, AuthUser>(authUsers.map((u) => [u.id, u]));
    const latestActivity = new Map<string, string>();
    for (const row of activity) {
        const seen = latestActivity.get(row.user_id);
        if (!seen || row.activity_date > seen) latestActivity.set(row.user_id, row.activity_date);
    }
    const latestHeartbeat = new Map<string, string>();
    for (const row of heartbeats) {
        const seen = latestHeartbeat.get(row.user_id);
        if (!seen || row.last_seen > seen) latestHeartbeat.set(row.user_id, row.last_seen);
    }

    return profiles.map((profile) => {
        const { at, source } = maxSeen([
            ['users.updated_at', profile.updated_at],
            ['auth.last_sign_in_at', authById.get(profile.id)?.last_sign_in_at],
            ['user_activity_log', latestActivity.get(profile.id) ?? null],
            ['heartbeats', latestHeartbeat.get(profile.id) ?? null],
        ]);
        return {
            profile,
            isAlt: profile.owner_auth_user_id !== null,
            lastSeen: at,
            lastSeenSource: source,
            idleDays: at ? Math.floor((now.getTime() - at.getTime()) / 86_400_000) : null,
        };
    });
};

export type Cohort = {
    /** Accounts the deletion would remove. */
    doomed: Account[];
    /** Idle accounts deliberately spared, with the reason. */
    spared: Array<{ account: Account; reason: string }>;
    kept: Account[];
};

/**
 * An account is doomed when it has been idle for `idleDays` AND nothing about it
 * says a live person still holds it: admins are never deleted, an account that
 * has never been seen at all is judged by `created_at`, a main is spared while
 * any of its alts is active, and an alt is spared while its main is active
 * (heartbeats key on the owner's auth id, so an alt's own last-seen understates).
 */
export const selectCohort = (accounts: Account[], idleDays: number, now: Date): Cohort => {
    const cutoff = new Date(now.getTime() - idleDays * 86_400_000);

    const isIdle = (a: Account): boolean => {
        const reference =
            a.lastSeen ?? (a.profile.created_at ? new Date(a.profile.created_at) : null);
        return reference !== null && reference < cutoff;
    };

    const altsByOwner = new Map<string, Account[]>();
    for (const a of accounts) {
        if (!a.isAlt) continue;
        const owner = a.profile.owner_auth_user_id as string;
        altsByOwner.set(owner, [...(altsByOwner.get(owner) ?? []), a]);
    }
    const byId = new Map(accounts.map((a) => [a.profile.id, a]));

    const doomed: Account[] = [];
    const spared: Array<{ account: Account; reason: string }> = [];
    const kept: Account[] = [];

    for (const a of accounts) {
        if (!isIdle(a)) {
            kept.push(a);
            continue;
        }
        if (a.profile.is_admin) {
            spared.push({ account: a, reason: 'admin' });
            continue;
        }
        if (!a.lastSeen && !a.profile.created_at) {
            spared.push({ account: a, reason: 'no last-seen and no created_at — cannot judge' });
            continue;
        }
        if (a.isAlt) {
            const main = byId.get(a.profile.owner_auth_user_id as string);
            if (main && !isIdle(main)) {
                spared.push({
                    account: a,
                    reason: `alt of an active main (${main.profile.email})`,
                });
                continue;
            }
        } else {
            const liveAlt = (altsByOwner.get(a.profile.id) ?? []).find((alt) => !isIdle(alt));
            if (liveAlt) {
                spared.push({ account: a, reason: `has an active alt (${liveAlt.profile.id})` });
                continue;
            }
        }
        doomed.push(a);
    }

    return { doomed, spared, kept };
};

/**
 * Tables holding per-account rows, keyed by the column carrying the account id.
 * `public.users.id` and `auth.users.id` are the same value for a main account,
 * so both groups are queried with the same id; an alt has rows only in the
 * `public.users`-keyed group.
 */
export const ACCOUNT_TABLES: Array<{ table: string; column: string }> = [
    { table: 'ships', column: 'user_id' },
    { table: 'inventory_items', column: 'user_id' },
    { table: 'loadouts', column: 'user_id' },
    { table: 'team_loadouts', column: 'user_id' },
    { table: 'encounter_notes', column: 'user_id' },
    { table: 'encounter_votes', column: 'user_id' },
    { table: 'engineering_stats', column: 'user_id' },
    { table: 'gear_wishlists', column: 'user_id' },
    { table: 'autogear_teams', column: 'user_id' },
    { table: 'statistics_snapshots', column: 'user_id' },
    { table: 'user_activity_log', column: 'user_id' },
    { table: 'autogear_configs', column: 'user_id' },
    { table: 'heartbeats', column: 'user_id' },
    { table: 'community_recommendation_votes', column: 'user_id' },
    { table: 'community_recommendations', column: 'created_by' },
];
