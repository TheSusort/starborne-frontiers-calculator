import fs from 'fs';
import path from 'path';
import type { Finding } from '../../src/utils/combat/audit/types';

/** `comparable` of `total` checks the oracle actually compared. */
export interface Coverage {
    comparable: number;
    total: number;
}

/** Each oracle's coverage. A low finding count is only good news next to a high coverage: a
 *  check that compared nothing reports exactly like a clean one. */
export interface LedgerCoverage {
    /** Inert-only calibration placements with a comparable alive window. */
    calibration: Coverage;
    /** Player placements with a comparable alive window. */
    differential: Coverage;
    /** Ablation subject-runs (two per pair per sampled seed) with a comparable alive window. */
    ablation: Coverage;
}

/** Inert-battery diffs the exclusion set did not absorb: the oracle's own false-positive floor
 *  for this sample, which the calibration gate held within `tolerance`. */
export interface CalibrationResidual {
    count: number;
    /** `count` over comparable calibration placements. */
    rate: number;
    /** The rate the gate tolerates (`CALIBRATION_RESIDUAL_TOLERANCE`). */
    tolerance: number;
    /** `+kind×n` / `-kind×n`, most frequent first (`residualHistogram`); empty when none. */
    histogram: string;
}

export interface LedgerMeta {
    compositionsRun: number;
    coverage: LedgerCoverage;
    calibrationResidual: CalibrationResidual;
}

const pct2 = (rate: number): string => `${(100 * rate).toFixed(2)}%`;

/**
 * What the differential and ablation oracles cannot see, by construction of their setup: they
 * compare only the rounds the subject was alive for in both arms, the wiping round excluded, and
 * the differential scales the subject's HP (`SUBJECT_HP_SCALE`).
 */
export const LEDGER_BLIND_SPOTS: readonly string[] = [
    "Gates on the subject's OWN HP (below-X% HP, would-be-destroyed, cheat death): the differential scales the subject's HP, so these fire later or never.",
    'On-kill and on-death effects in the round that wipes a side: that round is partial and is not compared.',
    'Anything after the subject dies, or after the shorter of the two arms ends.',
    "Outputs that scale with the subject's max HP (shields, reflect hits): `SUBJECT_HP_SCALE` multiplies them equally in both arms.",
    'Recipient-booked kinds (`EXCLUDED_KINDS` in oracleKinds.ts): an ally changing what is done TO the subject is not reported.',
];

export const pct = (c: Coverage): string =>
    c.total === 0 ? 'n/a' : `${((100 * c.comparable) / c.total).toFixed(0)}%`;

export const formatCoverage = (c: Coverage): string =>
    `${c.comparable}/${c.total} (${pct(c)})` +
    (c.comparable === 0 ? ' VACUOUS: compared nothing' : '');

export interface LedgerJson {
    compositionsRun: number;
    coverage: LedgerCoverage;
    calibrationResidual: CalibrationResidual;
    blindSpots: readonly string[];
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
        coverage: meta.coverage,
        calibrationResidual: meta.calibrationResidual,
        blindSpots: LEDGER_BLIND_SPOTS,
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
    lines.push('## Coverage');
    lines.push('');
    lines.push(
        `- Differential: **${formatCoverage(meta.coverage.differential)}** placements compared`
    );
    lines.push(`- Ablation: **${formatCoverage(meta.coverage.ablation)}** subject-runs compared`);
    lines.push(
        `- Calibration: **${formatCoverage(meta.coverage.calibration)}** inert placements compared`
    );
    const res = meta.calibrationResidual;
    lines.push(
        `- Calibration residual: **${res.count}** inert diff(s), **${pct2(res.rate)}** of compared ` +
            `placements (tolerance ${pct2(res.tolerance)})` +
            (res.histogram ? `: ${res.histogram}` : '')
    );
    lines.push('');
    lines.push('## Blind spots');
    lines.push('');
    for (const spot of LEDGER_BLIND_SPOTS) lines.push(`- ${spot}`);
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
