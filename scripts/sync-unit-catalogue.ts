/* eslint-disable no-console */
/**
 * Syncs ship_templates from the official unit catalogue.
 *
 * Usage: npm run sync:catalogue [-- --write] [--stats-only] [--allow-bulk-text] [--report <file>] [--issue-body <file>]
 *        [--outcome <file>] [--backup-dir <dir>]
 *        npm run sync:catalogue -- --print-cache-key
 *
 * Dry run by default (`--dry-run` is accepted and changes nothing). With --write it snapshots the whole table to --backup-dir BEFORE the first
 * write (no snapshot, no write), then applies the plan from scripts/lib/catalogueSyncPlan.ts.
 * Restore a snapshot with scripts/restore-ship-templates.ts.
 *
 * --allow-bulk-text lifts the bulk-text hold (see `planSync`); the scheduled workflow never passes it.
 * --report writes the full report; --issue-body writes the short summary meant for a GitHub issue.
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
import { renderIssueSummary, renderReport, syncStatus, type ReportContext, type SyncStatus } from './lib/syncReport';
import { backupFileName, buildBackup } from './lib/templateBackup';
import { flagValue } from './lib/cliArgs';

const main = async (): Promise<SyncStatus> => {
    const index = await fetchCatalogueIndex();
    if (process.argv.includes('--print-cache-key')) {
        console.log(`key=${cacheKey(index.manifest)}`);
        return 'clean';
    }
    const write = process.argv.includes('--write');
    const reportPath = flagValue(process.argv, '--report');
    const issueBodyPath = flagValue(process.argv, '--issue-body');
    const outcomePath = flagValue(process.argv, '--outcome');
    const backupDir = flagValue(process.argv, '--backup-dir') ?? 'docs/backups';

    // Imported here: the module exits when the service-role env is missing, which
    // --print-cache-key must not need.
    const db = await import('./lib/supabaseRest');

    const units = (await fetchCatalogueUnits(index.slugs)).map(toCatalogueTemplate);
    const raw = await db.selectAll<Record<string, unknown>>('ship_templates', 'select=*&order=id.asc');
    const templates = raw as unknown as TemplateRow[];
    const plan = planSync(diffCatalogue(units, templates), templates, auditGate, {
        textWrites: !process.argv.includes('--stats-only'),
        allowBulkText: process.argv.includes('--allow-bulk-text'),
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
    const reportCtx: ReportContext = { manifest: index.manifest, mode: write ? 'write' : 'dry-run', backupPath, writeFailures };
    const report = renderReport(plan, reportCtx);
    console.log(report);
    if (reportPath) writeFileSync(reportPath, report);
    if (issueBodyPath) writeFileSync(issueBodyPath, renderIssueSummary(plan, reportCtx));
    if (outcomePath) writeFileSync(outcomePath, JSON.stringify({ status }));
    return status;
};

main()
    .then((status) => process.exit(status === 'failed' ? 1 : 0))
    .catch((error) => {
        console.error(error);
        // A bad --outcome operand is itself one of the errors `main` can throw (flagValue parses
        // it inside `main`, so that throw already landed here) — re-parsing it to find where to
        // write the failure marker can throw again, with nowhere left to report it, so swallow
        // that case rather than crashing unhandled.
        try {
            const outcomePath = flagValue(process.argv, '--outcome');
            if (outcomePath) writeFileSync(outcomePath, JSON.stringify({ status: 'failed' }));
        } catch {
            // no-op: see comment above.
        }
        process.exit(1);
    });
