import { countRows } from './lib/supabaseRest';
import {
    ACCOUNT_TABLES,
    Account,
    DEFAULT_IDLE_DAYS,
    loadAccounts,
    selectCohort,
} from './lib/inactiveAccounts';

/**
 * Read-only report on accounts idle past a threshold: who they are, what would
 * be deleted, and what it would and would not do to the Supabase quota.
 *
 * Writes nothing. `delete-inactive-accounts.ts` reads the same cohort.
 */

/** Measured 2026-08-30: 441 B per `inventory_items` row, heap plus indexes. */
const BYTES_PER_INVENTORY_ROW = 441;

/** Long `in.(...)` filters get chunked to keep the request URL sane. */
const ID_CHUNK = 40;

const countForIds = async (table: string, column: string, ids: string[]): Promise<number> => {
    let total = 0;
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        total += await countRows(table, `${column}=in.(${chunk.join(',')})`);
    }
    return total;
};

const label = (a: Account): string =>
    `${a.profile.email ?? a.profile.username ?? '(no email)'}${a.isAlt ? ' [alt]' : ''}`;

const main = async (): Promise<void> => {
    const days = Number(
        process.argv.find((arg) => arg.startsWith('--days='))?.split('=')[1] ?? DEFAULT_IDLE_DAYS
    );
    if (!Number.isFinite(days) || days <= 0) {
        console.error('Usage: tsx scripts/inactive-accounts.ts [--days=180]');
        process.exit(1);
    }

    const now = new Date();
    const accounts = await loadAccounts(now);
    console.log(`${accounts.length} accounts (${accounts.filter((a) => a.isAlt).length} alts)\n`);

    console.log('Idle distribution');
    for (const threshold of [90, 180, 270, 365]) {
        const { doomed } = selectCohort(accounts, threshold, now);
        console.log(
            `  >= ${String(threshold).padStart(3)}d  ${String(doomed.length).padStart(3)} accounts`
        );
    }

    const { doomed, spared } = selectCohort(accounts, days, now);
    console.log(`\n=== Cohort at >= ${days}d: ${doomed.length} accounts ===\n`);

    // Per-account inventory counts for EVERY account, not just the cohort: the
    // active heavy users are the control group proving this counter can report
    // a large non-zero, so a cohort of zeros is a finding and not a broken query.
    const inventoryByAccount = new Map<string, number>();
    for (const a of accounts) {
        inventoryByAccount.set(
            a.profile.id,
            await countRows('inventory_items', `user_id=eq.${a.profile.id}`)
        );
    }

    const sortedDoomed = [...doomed].sort(
        (x, y) =>
            (inventoryByAccount.get(y.profile.id) ?? 0) -
            (inventoryByAccount.get(x.profile.id) ?? 0)
    );
    for (const a of sortedDoomed) {
        const gear = inventoryByAccount.get(a.profile.id) ?? 0;
        console.log(
            `  ${String(a.idleDays ?? '?').padStart(4)}d  ${String(gear).padStart(6)} gear  ` +
                `${label(a)}  (via ${a.lastSeenSource})`
        );
    }

    const control = [...accounts]
        .filter((a) => !doomed.includes(a))
        .sort(
            (x, y) =>
                (inventoryByAccount.get(y.profile.id) ?? 0) -
                (inventoryByAccount.get(x.profile.id) ?? 0)
        )
        .slice(0, 3);
    console.log('\nControl — heaviest accounts NOT in the cohort (the counter is live):');
    for (const a of control) {
        console.log(
            `  ${String(a.idleDays ?? '?').padStart(4)}d  ` +
                `${String(inventoryByAccount.get(a.profile.id) ?? 0).padStart(6)} gear  ${label(a)}`
        );
    }

    if (spared.length) {
        console.log('\nIdle but spared:');
        for (const { account, reason } of spared) {
            console.log(
                `  ${String(account.idleDays ?? '?').padStart(4)}d  ${label(account)} — ${reason}`
            );
        }
    }

    const ids = doomed.map((a) => a.profile.id);
    console.log('\nRows that would be deleted, by table:');
    let inventoryRows = 0;
    for (const { table, column } of ACCOUNT_TABLES) {
        const rows = ids.length ? await countForIds(table, column, ids) : 0;
        if (table === 'inventory_items') inventoryRows = rows;
        if (rows > 0) console.log(`  ${table.padEnd(32)} ${String(rows).padStart(7)}`);
    }
    console.log('  (plus child rows reached through ships, loadouts and encounter notes)');

    const publicNotes = ids.length
        ? await countForIds('encounter_notes', 'user_id', ids).then(async (all) => {
              let pub = 0;
              for (let i = 0; i < ids.length; i += ID_CHUNK) {
                  pub += await countRows(
                      'encounter_notes',
                      `user_id=in.(${ids.slice(i, i + ID_CHUNK).join(',')})&is_public=is.true`
                  );
              }
              return { all, pub };
          })
        : { all: 0, pub: 0 };
    const recommendations = ids.length
        ? await countForIds('community_recommendations', 'created_by', ids)
        : 0;
    console.log(
        `\nPreserved with authorship nulled: ${recommendations} community recommendation(s), ` +
            `${publicNotes.pub} public encounter note(s) of ${publicNotes.all}.`
    );

    const freedMb = (inventoryRows * BYTES_PER_INVENTORY_ROW) / 1_048_576;
    console.log(
        `\nEffect: frees ~${freedMb.toFixed(0)} MB of LIVE bytes. The dashboard number does NOT move —\n` +
            'a DELETE marks space reusable inside the existing table file; only DROP INDEX,\n' +
            'REINDEX or VACUUM FULL return bytes to the OS, and VACUUM FULL is ruled out here.\n' +
            'Run REINDEX CONCURRENTLY afterwards to convert this into a dashboard drop.'
    );
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
