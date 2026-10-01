/** Markdown report and outcome status for one catalogue sync run. Pure. */
import type { Change } from './catalogueDiff';
import type { CatalogueManifest } from './catalogueSchema';
import { isDroppedField, type RowPatch, type SyncPlan, type TextHold } from './catalogueSyncPlan';

export type SyncStatus = 'clean' | 'attention' | 'held' | 'failed';

export const syncStatus = (plan: SyncPlan, writeFailures: string[]): SyncStatus => {
    if (plan.halted || writeFailures.length) return 'failed';
    if (plan.mappingHeld.length || plan.patches.some((p) => p.heldText.length || p.heldDrops.length)) {
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

const textHoldLabel = (p: RowPatch, hold: TextHold): string => {
    switch (hold) {
        case 'gate':
            return 'held by the audit gate; new audit findings:';
        case 'dropped-field': {
            const cols = p.heldText.filter(isDroppedField).map((c) => (c.kind === 'skill-text' ? c.column : c.kind));
            return `held: ${DROPPED} (${cols.join(', ')})`;
        }
        case 'text-writes-off':
            return 'held: text writes disabled (--stats-only run)';
    }
};

const renderHeldText = (plan: SyncPlan): string[] => {
    const lines: string[] = [];
    const held = plan.patches.filter((p) => p.heldText.length);
    if (held.length) {
        lines.push('', `### Skill text held (${held.length} ships)`);
        for (const p of held) {
            lines.push('', `**${p.name}** — ${textHoldLabel(p, p.textHold ?? 'gate')}`);
            for (const f of p.gate?.newFindings ?? []) lines.push(`- ${f}`);
            for (const c of p.heldText) lines.push(`- ${describeChange(c)}`);
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

export const renderReport = (
    plan: SyncPlan,
    ctx: {
        manifest: CatalogueManifest;
        mode: 'dry-run' | 'write';
        backupPath: string | null;
        writeFailures: string[];
    }
): string => {
    const status = syncStatus(plan, ctx.writeFailures);
    const lines: string[] = [];
    lines.push(`## Catalogue sync — ${status} (${ctx.mode})`);
    lines.push('');
    lines.push(`Game ${ctx.manifest.gameVersion}, build ${ctx.manifest.build}, ${ctx.manifest.unitCount} units; ${plan.matchedCount} matched.`);
    if (ctx.backupPath) lines.push(`Snapshot before writing: \`${ctx.backupPath}\``);
    if (plan.halted) {
        lines.push('', `**HALTED — nothing written:** ${plan.halted}`);
        lines.push(...renderIdMismatches(plan));
        lines.push(...renderMissingFromCatalogue(plan));
        return lines.join('\n') + '\n';
    }
    if (ctx.writeFailures.length) lines.push('', `**Write failures:** ${ctx.writeFailures.join(', ')}`);

    const applied = plan.patches.filter((p) => p.applied.length);
    if (applied.length) {
        lines.push('', `### ${ctx.mode === 'write' ? 'Applied' : 'Would apply'} (${applied.length} ships)`);
        for (const p of applied) {
            lines.push('', `**${p.name}**`);
            for (const c of p.applied) lines.push(`- ${describeChange(c)}`);
        }
    }

    lines.push(...renderMappingHeld(plan));
    lines.push(...renderHeldText(plan));
    lines.push(...renderHeldDrops(plan));

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
    lines.push(...renderIdMismatches(plan));
    if (plan.metadata.length) {
        lines.push('', '### Metadata drift (report only)');
        for (const m of plan.metadata) lines.push(`- **${m.template.name}** ${describeChange(m.change)}`);
    }
    lines.push(...renderMissingFromCatalogue(plan));
    return lines.join('\n') + '\n';
};
