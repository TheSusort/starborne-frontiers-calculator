import fs from 'fs';
import path from 'path';
import type { Finding } from '../../src/utils/combat/audit/types';

interface LedgerMeta {
    compositionsRun: number;
}

export interface LedgerJson {
    compositionsRun: number;
    confirmed: Finding[];
    needsTriage: Finding[];
    // Reserved for future use: nothing currently produces a "refuted" Finding (there's no
    // re-triage workflow yet that would move a needsTriage entry here), so this is always `[]`.
    // Kept in the shape rather than dropped since ledger consumers (docs/interaction-audit-
    // ledger.json readers) may already expect the field to exist.
    refuted: Finding[];
}

/**
 * Pure function: builds the ledger JSON structure.
 * Splits findings by oracle type: ablation → needsTriage, others → confirmed.
 */
export function buildLedgerJson(findings: Finding[], meta: LedgerMeta): LedgerJson {
    const confirmed = findings.filter((f) => f.oracle !== 'ablation');
    const needsTriage = findings.filter((f) => f.oracle === 'ablation');

    return {
        compositionsRun: meta.compositionsRun,
        confirmed,
        needsTriage,
        refuted: [],
    };
}

/**
 * Pure function: renders the ledger as human-readable markdown.
 * Header with counts, then sections for confirmed and needs-triage findings.
 */
export function renderLedgerMarkdown(findings: Finding[], meta: LedgerMeta): string {
    const confirmed = findings.filter((f) => f.oracle !== 'ablation');
    const needsTriage = findings.filter((f) => f.oracle === 'ablation');

    const lines: string[] = [];

    // Header with counts
    lines.push('# Interaction Audit Ledger');
    lines.push('');
    lines.push(`- Compositions run: **${meta.compositionsRun}**`);
    lines.push(`- Confirmed findings: **${confirmed.length}**`);
    lines.push(`- Findings needing triage: **${needsTriage.length}**`);
    lines.push('');

    // Confirmed findings section
    if (confirmed.length > 0) {
        lines.push('## Confirmed');
        lines.push('');
        confirmed.forEach((finding) => {
            lines.push(renderFinding(finding));
        });
    }

    // Needs triage section
    if (needsTriage.length > 0) {
        lines.push('## Needs Triage');
        lines.push('');
        needsTriage.forEach((finding) => {
            lines.push(renderFinding(finding));
        });
    }

    return lines.join('\n');
}

/**
 * Render a single finding entry in markdown format.
 */
function renderFinding(finding: Finding): string {
    const lines: string[] = [];

    lines.push(`### ${finding.ships.join(', ')} (Seed: ${finding.seed})`);
    lines.push('');

    // Oracle type and severity
    lines.push(`**Oracle:** ${finding.oracle}`);
    lines.push(`**Severity:** ${finding.severity}`);
    lines.push('');

    // Slots/positions
    lines.push(`**Positions:** ${finding.slots.join(', ')}`);
    lines.push('');

    // Oracle-specific payload
    if (finding.invariant) {
        lines.push(`**Invariant:** ${finding.invariant}`);
        lines.push('');
    }

    if (finding.fingerprintDiff) {
        lines.push('**Fingerprint Diff:**');
        lines.push(`- Actor ID: ${finding.fingerprintDiff.actorId}`);
        lines.push(`- Ship: ${finding.fingerprintDiff.shipName}`);
        lines.push(
            `- Missing in composition: ${finding.fingerprintDiff.missingInComposition.join(', ')}`
        );
        lines.push(
            `- Extra in composition: ${finding.fingerprintDiff.extraInComposition.join(', ')}`
        );
        lines.push('');
    }

    if (finding.ablationDetail) {
        lines.push(`**Ablation Detail:** ${finding.ablationDetail}`);
        lines.push('');
    }

    if (finding.minimalRepro) {
        lines.push('**Minimal Repro:**');
        lines.push(`- Player ships: ${finding.minimalRepro.playerShips.join(', ')}`);
        lines.push(`- Enemy ships: ${finding.minimalRepro.enemyShips.join(', ')}`);
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Write the ledger files to disk.
 * Creates both interaction-audit-ledger.json and interaction-audit-ledger.md.
 * Returns the LedgerJson it built so callers (e.g. main()) don't need to rebuild it
 * themselves just to read back counts.
 */
export function writeLedger(findings: Finding[], meta: LedgerMeta, outDir: string): LedgerJson {
    // Ensure output directory exists
    fs.mkdirSync(outDir, { recursive: true });

    // Write JSON ledger
    const jsonPath = path.join(outDir, 'interaction-audit-ledger.json');
    const ledgerJson = buildLedgerJson(findings, meta);
    fs.writeFileSync(jsonPath, JSON.stringify(ledgerJson, null, 2));

    // Write markdown ledger
    const mdPath = path.join(outDir, 'interaction-audit-ledger.md');
    const ledgerMd = renderLedgerMarkdown(findings, meta);
    fs.writeFileSync(mdPath, ledgerMd);

    return ledgerJson;
}
