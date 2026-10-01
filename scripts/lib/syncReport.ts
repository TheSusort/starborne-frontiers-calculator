/** Markdown report and outcome status for one catalogue sync run. Pure. */
import type { Change } from './catalogueDiff';
import type { CatalogueManifest } from './catalogueSchema';
import { isDroppedField, TEXT_CHANGE_HOLD_RATIO, type RowPatch, type SyncPlan, type TextHold } from './catalogueSyncPlan';

export type SyncStatus = 'clean' | 'attention' | 'held' | 'failed';

export const syncStatus = (plan: SyncPlan, writeFailures: string[]): SyncStatus => {
    if (plan.halted || writeFailures.length) return 'failed';
    if (
        plan.bulkTextHold ||
        plan.mappingHeld.length ||
        plan.patches.some((p) => p.heldText.length || p.heldDrops.length)
    ) {
        return 'held';
    }
    if (
        plan.inserts.length ||
        plan.refusedInserts.length ||
        plan.metadata.length ||
        plan.idMismatches.length ||
        plan.missingFromCatalogue.length
    ) {
        return 'attention';
    }
    return 'clean';
};

const show = (v: unknown) => (v === null || v === undefined ? '∅' : String(v));
const fence = (s: string | null) => '```\n' + (s ?? '∅') + '\n```';

const describeChange = (c: Change): string => {
    switch (c.kind) {
        case 'stats':
            return `${c.field}: ${show(c.before)} → ${c.after}`;
        case 'charge-cost':
            return `charge cost: ${show(c.before)} → ${show(c.after)}`;
        case 'ascension':
            return `refit stats: ${Array.isArray(c.before) ? c.before.length : 0} → ${c.after.length} rows`;
        case 'skill-text':
            return `${c.column}:\n\n<details><summary>before / after</summary>\n\n${fence(c.before)}\n\n${fence(c.after)}\n\n</details>`;
        case 'metadata':
            return `${c.field}: ${show(c.before)} → ${c.after}`;
    }
};

/** definition_id mismatches: rendered on every outcome, including a halted run, because they explain why a run halted. */
const renderIdMismatches = (plan: SyncPlan): string[] => {
    const lines: string[] = [];
    if (plan.idMismatches.length) {
        lines.push('', '### definition_id mismatches (row matched by name; fix the id)');
        for (const m of plan.idMismatches) {
            lines.push(`- **${m.template.name}** (\`${m.template.id}\`): ours ${JSON.stringify(m.template.definition_id)}, catalogue \`${m.unit.definitionId}\``);
        }
    }
    return lines;
};

/** Rows in ship_templates the catalogue no longer has: rendered on every outcome, including a halted run, because they explain why a run halted. */
const renderMissingFromCatalogue = (plan: SyncPlan): string[] => {
    const lines: string[] = [];
    if (plan.missingFromCatalogue.length) {
        lines.push('', '### In ship_templates but not in the catalogue');
        lines.push(`- ${plan.missingFromCatalogue.map((t) => t.name).join(', ')}`);
    }
    return lines;
};

const DROPPED = 'the catalogue dropped this field';

const columnsOf = (changes: Change[]): string =>
    changes.map((c) => (c.kind === 'skill-text' ? c.column : c.kind)).join(', ');

const textHoldLabel = (p: RowPatch, hold: TextHold): string => {
    switch (hold) {
        case 'gate':
            return 'held by the audit gate; new audit findings:';
        case 'dropped-field':
            return `held: ${DROPPED} (${columnsOf(p.heldText.filter(isDroppedField))})`;
        case 'text-writes-off':
        case 'bulk-text':
            return `held: ${RUN_WIDE_HOLD[hold]}`;
    }
};

/** Holds that apply to every ship's text at once, rather than being decided ship by ship. */
const RUN_WIDE_HOLD: Partial<Record<TextHold, string>> = {
    'text-writes-off': 'text writes disabled (--stats-only run)',
    'bulk-text': 'bulk-text hold',
};

const renderBulkTextHold = (plan: SyncPlan): string[] => {
    if (!plan.bulkTextHold) return [];
    const { changed, matched } = plan.bulkTextHold;
    return [
        '',
        `**Bulk-text hold:** ${changed}/${matched} matched ships (${Math.round((changed / matched) * 100)}%) changed skill text, over the ${TEXT_CHANGE_HOLD_RATIO * 100}% limit. All text is held and no new ship is inserted; stats still write. Once the parser reads the new text, rerun with \`--allow-bulk-text\`.`,
    ];
};

/** `withText` prints each held column's before/after; without it only the column names. */
const renderHeldText = (plan: SyncPlan, withText: boolean): string[] => {
    const lines: string[] = [...renderBulkTextHold(plan)];
    const held = plan.patches.filter((p) => p.heldText.length);
    if (held.length) {
        lines.push('', `### Skill text held (${held.length} ships)`);
        for (const [hold, label] of Object.entries(RUN_WIDE_HOLD) as [TextHold, string][]) {
            const names = withText ? [] : held.filter((p) => p.textHold === hold).map((p) => p.name);
            if (names.length) lines.push('', `Text held for ${names.length} ships — ${label}: ${names.join(', ')}`);
        }
        for (const p of held) {
            if (!withText && p.textHold && RUN_WIDE_HOLD[p.textHold]) continue;
            lines.push('', `**${p.name}** — ${textHoldLabel(p, p.textHold ?? 'gate')}`);
            for (const f of p.gate?.newFindings ?? []) lines.push(`- ${f}`);
            if (withText) for (const c of p.heldText) lines.push(`- ${describeChange(c)}`);
            else lines.push(`- columns: ${columnsOf(p.heldText)}`);
        }
    }
    return lines;
};

const renderHeldDrops = (plan: SyncPlan): string[] => {
    const lines: string[] = [];
    const held = plan.patches.filter((p) => p.heldDrops.length);
    if (held.length) {
        lines.push('', `### Dropped values held (${held.length} ships)`);
        for (const p of held) {
            for (const c of p.heldDrops) lines.push(`- **${p.name}** ${describeChange(c)} — ${DROPPED}`);
        }
    }
    return lines;
};

const renderMappingHeld = (plan: SyncPlan): string[] => {
    const lines: string[] = [];
    if (plan.mappingHeld.length) {
        lines.push('', `### Mapping errors — ship not written (${plan.mappingHeld.length})`);
        for (const m of plan.mappingHeld) {
            lines.push(`- **${m.template.name}** (\`${m.template.id}\`): ${m.reasons.join('; ')}`);
        }
    }
    return lines;
};

const renderInserts = (plan: SyncPlan): string[] => {
    const lines: string[] = [];
    if (plan.inserts.length) {
        lines.push('', `### New ships (${plan.inserts.length}) — need images, targeting and lore by hand`);
        for (const i of plan.inserts) {
            lines.push('', `**${i.unit.name}** (\`${String(i.row.id)}\`)`);
            lines.push(`- upload \`${show(i.unit.imageKey)}_BigPortrait.jpg\` to Cloudinary from ${show(i.unit.images.bigPortrait)}`);
            lines.push('- set active/charged targeting and pattern in the Admin Panel');
            for (const f of i.findings) lines.push(`- audit finding: ${f}`);
        }
    }
    if (plan.refusedInserts.length) {
        lines.push('', '### New ships NOT inserted');
        for (const r of plan.refusedInserts) lines.push(`- **${r.unit.name}** (\`${r.unit.definitionId}\`): ${r.reason}`);
    }
    return lines;
};

const renderMetadata = (plan: SyncPlan): string[] => {
    const lines: string[] = [];
    if (plan.metadata.length) {
        lines.push('', '### Metadata drift (report only)');
        for (const m of plan.metadata) lines.push(`- **${m.template.name}** ${describeChange(m.change)}`);
    }
    return lines;
};

export interface ReportContext {
    manifest: CatalogueManifest;
    mode: 'dry-run' | 'write';
    backupPath: string | null;
    writeFailures: string[];
}

const renderHeader = (plan: SyncPlan, ctx: ReportContext): string[] => [
    `## Catalogue sync — ${syncStatus(plan, ctx.writeFailures)} (${ctx.mode})`,
    '',
    `Game ${ctx.manifest.gameVersion}, build ${ctx.manifest.build}, ${ctx.manifest.unitCount} units; ${plan.matchedCount} matched.`,
];

/** A halted run writes nothing, so it shows the halt reason and the join diagnostics that explain it. */
const renderHalt = (plan: SyncPlan): string[] => [
    '',
    `**HALTED — nothing written:** ${plan.halted}`,
    ...renderIdMismatches(plan),
    ...renderMissingFromCatalogue(plan),
];

const renderWriteFailures = (ctx: ReportContext): string[] =>
    ctx.writeFailures.length ? ['', `**Write failures:** ${ctx.writeFailures.join(', ')}`] : [];

/** Everything after the applied changes: the sections that need a human. */
const renderAttention = (plan: SyncPlan, withText: boolean): string[] => [
    ...renderMappingHeld(plan),
    ...renderHeldText(plan, withText),
    ...renderHeldDrops(plan),
    ...renderInserts(plan),
    ...renderIdMismatches(plan),
    ...renderMetadata(plan),
    ...renderMissingFromCatalogue(plan),
];

/** The full report: every applied change with its before/after. For the job summary and artifact. */
export const renderReport = (plan: SyncPlan, ctx: ReportContext): string => {
    const lines = renderHeader(plan, ctx);
    if (ctx.backupPath) lines.push(`Snapshot before writing: \`${ctx.backupPath}\``);
    if (plan.halted) return [...lines, ...renderHalt(plan)].join('\n') + '\n';
    lines.push(...renderWriteFailures(ctx));

    const applied = plan.patches.filter((p) => p.applied.length);
    if (applied.length) {
        lines.push('', `### ${ctx.mode === 'write' ? 'Applied' : 'Would apply'} (${applied.length} ships)`);
        for (const p of applied) {
            lines.push('', `**${p.name}**`);
            for (const c of p.applied) lines.push(`- ${describeChange(c)}`);
        }
    }
    lines.push(...renderAttention(plan, true));
    return lines.join('\n') + '\n';
};

/** GitHub rejects an issue or comment body over 65,536 characters. */
export const ISSUE_SUMMARY_LIMIT = 60_000;
const TRUNCATED_NOTE = '\n\n…truncated: the full report is in the job summary and the run\'s artifact.\n';

/**
 * The issue body: only what needs a human, with applied changes as a count and held text as
 * column names. Deterministic for a given plan (no timestamps or paths), so its hash dedupes
 * repeat filings. Never longer than `ISSUE_SUMMARY_LIMIT`.
 */
export const renderIssueSummary = (plan: SyncPlan, ctx: ReportContext): string => {
    const lines = renderHeader(plan, ctx);
    if (plan.halted) {
        lines.push(...renderHalt(plan));
    } else {
        lines.push(...renderWriteFailures(ctx));
        const applied = plan.patches.filter((p) => p.applied.length).length;
        if (applied) {
            const verb = ctx.mode === 'write' ? 'updated' : 'would be updated';
            lines.push('', `${applied} ships ${verb}; full diff in the job summary and artifact.`);
        }
        lines.push(...renderAttention(plan, false));
    }
    const body = lines.join('\n') + '\n';
    if (body.length <= ISSUE_SUMMARY_LIMIT) return body;
    return body.slice(0, ISSUE_SUMMARY_LIMIT - TRUNCATED_NOTE.length) + TRUNCATED_NOTE;
};
