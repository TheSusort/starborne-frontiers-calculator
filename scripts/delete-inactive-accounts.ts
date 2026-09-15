import 'dotenv/config';
import { DEFAULT_IDLE_DAYS, loadAccounts, selectCohort, Account } from './lib/inactiveAccounts';

/**
 * Deletes accounts idle past a threshold. Requires --confirm; without it this
 * prints the plan and exits, which is what `inactive-accounts.ts` reports on in
 * more detail.
 *
 * Each account is removed by `public.admin_delete_account`, one transaction per
 * account, so a failure leaves that account whole. The `auth.users` row is a
 * separate GoTrue call afterwards: it is outside that transaction, so a crash
 * between the two leaves an auth row with no profile — harmless, and a re-run
 * skips it because the profile is already gone.
 */

const url = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const authHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
};

const flag = (name: string): string | undefined =>
    process.argv
        .find((arg) => arg.startsWith(`--${name}=`))
        ?.split('=')
        .slice(1)
        .join('=');

const deleteProfile = async (id: string): Promise<Record<string, number>> => {
    const res = await fetch(`${url}/rest/v1/rpc/admin_delete_account`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ target_user_id: id }),
    });
    if (!res.ok)
        throw new Error(`admin_delete_account(${id}) -> ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, number>;
};

/** Alts have no auth row; a 404 for one is the expected answer, not a failure. */
const deleteAuthUser = async (id: string): Promise<'deleted' | 'absent'> => {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
    });
    if (res.status === 404) return 'absent';
    if (!res.ok) throw new Error(`DELETE auth user ${id} -> ${res.status} ${await res.text()}`);
    return 'deleted';
};

const main = async (): Promise<void> => {
    const days = Number(flag('days') ?? DEFAULT_IDLE_DAYS);
    const confirm = process.argv.includes('--confirm');
    const only = flag('only');
    const limit = flag('limit') ? Number(flag('limit')) : Infinity;

    const now = new Date();
    const accounts = await loadAccounts(now);
    const { doomed } = selectCohort(accounts, days, now);

    // Deleting a main's auth row would violate an alt's owner_auth_user_id FK,
    // so alts go first regardless of the order the cohort came back in.
    const ordered = [...doomed].sort((a, b) => Number(b.isAlt) - Number(a.isAlt));
    const targets = ordered
        .filter((a) => !only || a.profile.email === only || a.profile.id === only)
        .slice(0, limit);

    if (only && targets.length === 0) {
        console.error(`"${only}" is not in the >= ${days}d cohort. Refusing.`);
        process.exit(1);
    }

    const name = (a: Account): string =>
        `${a.profile.email ?? a.profile.id}${a.isAlt ? ' [alt]' : ''}`;

    if (!confirm) {
        console.log(
            `Would delete ${targets.length} of ${doomed.length} accounts idle >= ${days}d:`
        );
        for (const a of targets) console.log(`  ${a.idleDays}d  ${name(a)}`);
        console.log('\nRe-run with --confirm to write.');
        return;
    }

    console.log(`Deleting ${targets.length} account(s)...\n`);
    let failures = 0;
    for (const account of targets) {
        try {
            const removed = await deleteProfile(account.profile.id);
            const auth = account.isAlt ? 'absent' : await deleteAuthUser(account.profile.id);
            console.log(
                `  ok    ${name(account)} — ${removed.inventory_items ?? 0} gear, ` +
                    `${removed.ships ?? 0} ships, auth ${auth}`
            );
        } catch (error) {
            failures++;
            console.error(`  FAIL  ${name(account)} — ${(error as Error).message}`);
        }
    }
    console.log(`\n${targets.length - failures} deleted, ${failures} failed.`);
    if (failures) process.exit(1);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
