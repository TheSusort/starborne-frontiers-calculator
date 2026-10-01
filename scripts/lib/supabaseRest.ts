import 'dotenv/config';

/**
 * Plain-fetch access to Supabase's REST surfaces, for admin scripts.
 *
 * Not `@supabase/supabase-js`: its realtime dependency needs a global WebSocket, and plain
 * fetch keeps these scripts free of that requirement.
 */

const url = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const baseUrl = url.replace(/\/$/, '');

const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
});

const PAGE = 1000;

/** Every row of a PostgREST query, paged past the server's row cap. */
export const selectAll = async <T>(table: string, query: string): Promise<T[]> => {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
        const res = await fetch(
            `${baseUrl}/rest/v1/${table}?${query}&limit=${PAGE}&offset=${offset}`,
            { headers: headers() }
        );
        if (!res.ok) {
            throw new Error(`GET ${table}?${query} -> ${res.status} ${await res.text()}`);
        }
        const page = (await res.json()) as T[];
        rows.push(...page);
        if (page.length < PAGE) return rows;
    }
};

/** Exact row count for a filter, without transferring the rows. */
export const countRows = async (table: string, filter: string): Promise<number> => {
    const res = await fetch(`${baseUrl}/rest/v1/${table}?select=*&${filter}&limit=0`, {
        headers: headers({ Prefer: 'count=exact' }),
    });
    if (!res.ok) {
        throw new Error(`COUNT ${table}?${filter} -> ${res.status} ${await res.text()}`);
    }
    // content-range is "0-*/<count>" (or "*/<count>" for an empty page)
    const range = res.headers.get('content-range') ?? '';
    const total = Number(range.split('/')[1]);
    if (!Number.isFinite(total)) throw new Error(`no count in content-range: "${range}"`);
    return total;
};

export type AuthUser = {
    id: string;
    email?: string;
    last_sign_in_at: string | null;
    created_at: string;
};

/** Every row of `auth.users`, which PostgREST does not expose, via the GoTrue admin API. */
export const listAuthUsers = async (): Promise<AuthUser[]> => {
    const users: AuthUser[] = [];
    for (let page = 1; ; page++) {
        const res = await fetch(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=${PAGE}`, {
            headers: headers(),
        });
        if (!res.ok) {
            throw new Error(`GET admin/users page ${page} -> ${res.status} ${await res.text()}`);
        }
        const body = (await res.json()) as { users: AuthUser[] };
        users.push(...body.users);
        if (body.users.length < PAGE) return users;
    }
};

const send = async (method: string, path: string, body?: unknown, prefer?: string): Promise<Response> => {
    const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
        method,
        headers: headers({
            'Content-Type': 'application/json',
            ...(prefer ? { Prefer: prefer } : {}),
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return res;
};

const inList = (ids: string[]) => `in.(${ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')})`;

/** PATCH one row by id. Throws unless exactly one row was updated: a PATCH matching nothing still answers 200. */
export const patchRow = async (
    table: string,
    idColumn: string,
    id: string,
    patch: Record<string, unknown>
): Promise<void> => {
    const res = await send('PATCH', `${table}?${idColumn}=eq.${encodeURIComponent(id)}`, patch, 'return=representation');
    const rows: unknown = await res.json();
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count !== 1) throw new Error(`PATCH ${table} ${idColumn}=${id} updated ${count} rows, expected 1`);
};

export const insertRows = (table: string, rows: Record<string, unknown>[]) =>
    send('POST', table, rows, 'return=minimal');

/** Insert-or-replace on `onConflict` (the primary key column). */
export const upsertRows = (table: string, rows: Record<string, unknown>[], onConflict: string) =>
    send('POST', `${table}?on_conflict=${onConflict}`, rows, 'resolution=merge-duplicates,return=minimal');

export const deleteRows = (table: string, idColumn: string, ids: string[]) =>
    send('DELETE', `${table}?${idColumn}=${encodeURIComponent(inList(ids))}`, undefined, 'return=minimal');
