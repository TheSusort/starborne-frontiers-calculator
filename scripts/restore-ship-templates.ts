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

const argValue = (flag: string): string | null => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const main = async () => {
    const file = argValue('--file');
    if (!file) {
        console.error('--file <backup.json> is required');
        process.exit(1);
    }
    const ids = argValue('--ids')?.split(',').map((s) => s.trim()).filter(Boolean);
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
