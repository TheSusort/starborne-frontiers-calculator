/* eslint-disable no-console */
/**
 * Syncs ship_templates from the official unit catalogue.
 *
 * Usage: npm run sync:catalogue [-- --write] [--stats-only] [--report <file>] [--outcome <file>] [--backup-dir <dir>]
 *        npm run sync:catalogue -- --print-cache-key
 *
 * Dry run by default (`--dry-run` is accepted and changes nothing). With --write it snapshots the whole table to --backup-dir BEFORE the first
 * write (no snapshot, no write), then applies the plan from scripts/lib/catalogueSyncPlan.ts.
 * Restore a snapshot with scripts/restore-ship-templates.ts.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (ship_templates is admin-write).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cacheKey, fetchCatalogueIndex, fetchCatalogueUnits } from './lib/catalogueFetch';
import { toCatalogueTemplate } from './lib/catalogueMapping';
import { diffCatalogue, type TemplateRow } from './lib/catalogueDiff';
import { planSync } from './lib/catalogueSyncPlan';
import { auditGate } from './lib/skillTextGate';
import { renderReport, syncStatus, type SyncStatus } from './lib/syncReport';
import { backupFileName, buildBackup } from './lib/templateBackup';

const argValue = (flag: string): string | null => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const main = async (): Promise<SyncStatus> => {
    const index = await fetchCatalogueIndex();
    if (process.argv.includes('--print-cache-key')) {
        console.log(`key=${cacheKey(index.manifest)}`);
        return 'clean';
    }
    const write = process.argv.includes('--write');
    const reportPath = argValue('--report');
    const outcomePath = argValue('--outcome');
    const backupDir = argValue('--backup-dir') ?? 'docs/backups';

    // Imported here: the module exits when the service-role env is missing, which
    // --print-cache-key must not need.
    const db = await import('./lib/supabaseRest');

    const units = (await fetchCatalogueUnits(index.slugs)).map(toCatalogueTemplate);
    const raw = await db.selectAll<Record<string, unknown>>('ship_templates', 'select=*&order=id.asc');
    const templates = raw as unknown as TemplateRow[];
    const plan = planSync(diffCatalogue(units, templates), templates, auditGate, {
        textWrites: !process.argv.includes('--stats-only'),
    });

    let backupPath: string | null = null;
    const writeFailures: string[] = [];
    if (write && !plan.halted) {
        const takenAt = new Date();
        mkdirSync(backupDir, { recursive: true });
        backupPath = join(backupDir, backupFileName(takenAt));
        writeFileSync(backupPath, JSON.stringify(buildBackup(raw, takenAt), null, 2));

        const updatedAt = new Date().toISOString();
        for (const p of plan.patches) {
            if (Object.keys(p.patch).length === 0) continue;
            try {
                await db.patchRow('ship_templates', 'id', p.id, { ...p.patch, updated_at: updatedAt });
            } catch (error) {
                console.error(`patch ${p.name}:`, error);
                writeFailures.push(p.name);
            }
        }
        for (const i of plan.inserts) {
            try {
                await db.insertRows('ship_templates', [i.row]);
            } catch (error) {
                console.error(`insert ${i.unit.name}:`, error);
                writeFailures.push(i.unit.name);
            }
        }
    }

    const status = syncStatus(plan, writeFailures);
    const report = renderReport(plan, {
        manifest: index.manifest,
        mode: write ? 'write' : 'dry-run',
        backupPath,
        writeFailures,
    });
    console.log(report);
    if (reportPath) writeFileSync(reportPath, report);
    if (outcomePath) writeFileSync(outcomePath, JSON.stringify({ status }));
    return status;
};

main()
    .then((status) => process.exit(status === 'failed' ? 1 : 0))
    .catch((error) => {
        console.error(error);
        const outcomePath = argValue('--outcome');
        if (outcomePath) writeFileSync(outcomePath, JSON.stringify({ status: 'failed' }));
        process.exit(1);
    });
