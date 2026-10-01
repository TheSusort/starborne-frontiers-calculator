/* eslint-disable no-console */
/**
 * Restores ship_templates from a snapshot written by sync-unit-catalogue.ts (or the
 * docs/backups baseline).
 *
 * Usage: npm run restore:ship-templates -- --file <backup.json> [--ids A,B] [--prune-added] [--write]
 *
 * Dry run by default: prints which rows and columns would change. --write upserts the backup's
 * rows, then — only with --prune-added and no --ids, and only after the upsert succeeded —
 * deletes rows that did not exist when the snapshot was taken.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'fs';
import { parseBackup, planRestore } from './lib/templateBackup';
import { deleteRows, selectAll, upsertRows } from './lib/supabaseRest';
import { flagValue, parseIds } from './lib/cliArgs';

const main = async () => {
    const file = flagValue(process.argv, '--file');
    if (!file) {
        console.error('--file <backup.json> is required');
        process.exit(1);
    }
    // Parsed before the backup file or the DB is touched: a malformed --ids must abort the run,
    // not silently fall through to "no id filter" (which would select every row).
    const idsRaw = flagValue(process.argv, '--ids');
    const ids = idsRaw === null ? undefined : parseIds(idsRaw);
    const backup = parseBackup(readFileSync(file, 'utf8'));
    const current = await selectAll<Record<string, unknown>>('ship_templates', 'select=*&order=id.asc');
    const plan = planRestore(backup, current, { ids, pruneAdded: process.argv.includes('--prune-added') });

    console.log(`backup ${file} taken ${backup.takenAt}, ${backup.rowCount} rows`);
    for (const u of plan.upserts) console.log(`restore ${u.id}: ${u.changedColumns.join(', ')}`);
    console.log(`${plan.unchanged.length} rows already match`);
    if (plan.added.length) console.log(`added since backup: ${plan.added.join(', ')}`);
    if (plan.prune.length) console.log(`will delete: ${plan.prune.join(', ')}`);
    if (plan.unknownIds.length) console.log(`unknown ids: ${plan.unknownIds.join(', ')}`);

    if (!process.argv.includes('--write')) {
        console.log('dry run: nothing written (pass --write to apply)');
        return;
    }
    if (plan.upserts.length) {
        await upsertRows('ship_templates', plan.upserts.map((u) => u.row), 'id');
        console.log(`restored ${plan.upserts.length} rows`);
    }
    if (plan.prune.length) {
        await deleteRows('ship_templates', 'id', plan.prune);
        console.log(`deleted ${plan.prune.length} rows`);
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
