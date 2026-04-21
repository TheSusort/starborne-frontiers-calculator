import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error('SUPABASE_URL is required');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
    _client = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    return _client;
}

export function assertIsTestEmail(email: string, domain: string): void {
    // Safety rail: this helper must never touch non-test users.
    // Pattern: e2e-<uuid>@<exact test domain>
    const pattern = new RegExp(
        `^e2e-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@${escapeRegex(domain)}$`
    );
    if (!pattern.test(email)) {
        throw new Error(
            `refusing to operate on non-test email: ${email} (expected match for ${pattern})`
        );
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
    const client = getAdminClient();
    // admin.listUsers is paginated; for our scale (one signup per run),
    // the target user is always on page 1 when filtering by recent creation.
    // If auth.users ever exceeds 1000, switch to a direct SQL query via an RPC.
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    return user?.id ?? null;
}

export async function confirmUserEmail(userId: string): Promise<void> {
    const client = getAdminClient();
    const { error } = await client.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) throw error;
}

export async function deleteTestUser(email: string, domain: string): Promise<void> {
    assertIsTestEmail(email, domain);
    const client = getAdminClient();
    const userId = await findUserIdByEmail(email);
    if (!userId) return; // already gone
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw error;
}

export async function listOrphanTestUsers(
    domain: string,
    olderThan: Date
): Promise<Array<{ id: string; email: string; created_at: string }>> {
    const client = getAdminClient();
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return data.users
        .filter((u) => {
            if (!u.email) return false;
            try {
                assertIsTestEmail(u.email, domain);
            } catch {
                return false;
            }
            return new Date(u.created_at) < olderThan;
        })
        .map((u) => ({ id: u.id, email: u.email!, created_at: u.created_at }));
}
