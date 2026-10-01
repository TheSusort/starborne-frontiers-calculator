/**
 * Full-table snapshots of `ship_templates` and the restore plan built from one. Pure.
 *
 * A restore upserts backup rows that differ from the live row (or no longer exist). Rows added
 * since the backup are reported, and pruned only when asked — the caller prunes AFTER the upsert
 * succeeds, and only rows absent from the backup.
 */
import { z } from 'zod';
import { stableStringify } from './catalogueDiff';

export interface TemplateBackup {
    table: 'ship_templates';
    takenAt: string;
    rowCount: number;
    rows: Record<string, unknown>[];
}

const backupSchema = z
    .object({
        table: z.literal('ship_templates'),
        takenAt: z.string(),
        rowCount: z.number().int(),
        rows: z.array(z.looseObject({ id: z.string().min(1) })),
    })
    .refine((b) => b.rows.length === b.rowCount, { message: 'rowCount does not match rows' });

export const buildBackup = (rows: Record<string, unknown>[], takenAt: Date): TemplateBackup => ({
    table: 'ship_templates',
    takenAt: takenAt.toISOString(),
    rowCount: rows.length,
    rows,
});

export const backupFileName = (takenAt: Date): string =>
    `ship_templates-${takenAt.toISOString().replace(/[:.]/g, '-')}.json`;

export const parseBackup = (json: string): TemplateBackup =>
    backupSchema.parse(JSON.parse(json)) as TemplateBackup;

export interface RestorePlan {
    upserts: { id: string; changedColumns: string[]; row: Record<string, unknown> }[];
    unchanged: string[];
    added: string[];
    prune: string[];
    unknownIds: string[];
}

/** `--prune-added` is ignored when `opts.ids` is given: pruning is a whole-table operation. */
export const planRestore = (
    backup: TemplateBackup,
    current: Record<string, unknown>[],
    opts: { ids?: string[]; pruneAdded: boolean }
): RestorePlan => {
    const live = new Map(current.map((row) => [String(row.id), row]));
    const backed = new Map(backup.rows.map((row) => [String(row.id), row]));
    const wanted = opts.ids ? new Set(opts.ids) : null;
    const inScope = (id: string) => !wanted || wanted.has(id);

    const plan: RestorePlan = { upserts: [], unchanged: [], added: [], prune: [], unknownIds: [] };
    for (const [id, row] of backed) {
        if (!inScope(id)) continue;
        const now = live.get(id);
        const changedColumns = Object.keys(row).filter(
            (col) => !now || stableStringify(now[col]) !== stableStringify(row[col])
        );
        if (changedColumns.length) plan.upserts.push({ id, changedColumns, row });
        else plan.unchanged.push(id);
    }
    plan.added = [...live.keys()].filter((id) => !backed.has(id) && inScope(id));
    plan.prune = opts.pruneAdded && !wanted ? plan.added : [];
    plan.unknownIds = wanted ? [...wanted].filter((id) => !backed.has(id) && !live.has(id)) : [];
    return plan;
};
