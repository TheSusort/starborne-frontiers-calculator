import fs from 'fs';
import path from 'path';
import type { DriftReason, Finding, OracleKind } from '../../src/utils/combat/audit/types';

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
    'An ally that only moves a kind by up to `TIMING_SLACK_ROUNDS` rounds, or whose effect a second draw of stand-ins also produces, is listed under Drift, not Confirmed.',
];

export const pct = (c: Coverage): string =>
    c.total === 0 ? 'n/a' : `${((100 * c.comparable) / c.total).toFixed(0)}%`;

export const formatCoverage = (c: Coverage): string =>
    `${c.comparable}/${c.total} (${pct(c)})` +
    (c.comparable === 0 ? ' VACUOUS: compared nothing' : '');

/**
 * Every finding of one (ships, kind): the same interaction reported on several seeds collapses to
 * one row. A finding naming several kinds joins one group per kind.
 */
export interface FindingGroup {
    oracle: OracleKind;
    /** The subject (differential), the pair in name order (ablation), or the ships the violation
     *  named (invariant). */
    ships: string[];
    /** `-k`: suppressed beside the subject's allies; `+k`: only beside them (differential).
     *  `<ship> +k`: that ship gained k beside its partner (ablation). The invariant id. */
    kind: string;
    count: number;
    seeds: number[];
    /** Each distinct placement the group was seen at, slots comma-joined. */
    positions: string[];
    /** The member with the smallest minimal repro, lowest seed first among equals. */
    sample: Finding;
    /** Drift tier: how many member findings each rule demoted. A confirmed group: how many
     *  findings of the same (ships, kind) were demoted elsewhere (`tierGroups`). */
    drift?: Partial<Record<DriftReason, number>>;
}

/** The kinds `finding` is grouped under (`FindingGroup.kind`). */
export function findingKinds(finding: Finding): string[] {
    if (finding.fingerprintDiff) {
        return [
            ...finding.fingerprintDiff.missingInComposition.map((k) => `-${k}`),
            ...finding.fingerprintDiff.extraInComposition.map((k) => `+${k}`),
        ];
    }
    if (finding.ablationGained?.length) {
        return finding.ablationGained.flatMap((g) => g.kinds.map((k) => `${g.ship} +${k}`));
    }
    return [finding.invariant ?? finding.ablationDetail ?? 'unspecified'];
}

const reproSize = (f: Finding): number =>
    f.minimalRepro
        ? f.minimalRepro.playerShips.length + f.minimalRepro.enemyShips.length
        : Number.POSITIVE_INFINITY;

/** `findings` grouped by (oracle, ships, kind), most frequent first. */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
    const groups = new Map<string, FindingGroup>();
    for (const f of findings) {
        const ships = f.oracle === 'ablation' ? [...f.ships].sort() : [...f.ships];
        const placed = f.slots.join(',');
        for (const kind of findingKinds(f)) {
            const key = `${f.oracle}|${ships.join('+')}|${kind}`;
            const reason = f.drift?.find((d) => `${d.sign}${d.kind}` === kind)?.reason;
            const g = groups.get(key);
            if (!g) {
                groups.set(key, {
                    oracle: f.oracle,
                    ships,
                    kind,
                    count: 1,
                    seeds: [f.seed],
                    positions: [placed],
                    sample: f,
                    ...(reason ? { drift: { [reason]: 1 } } : {}),
                });
                continue;
            }
            if (reason) g.drift = { ...g.drift, [reason]: (g.drift?.[reason] ?? 0) + 1 };
            g.count++;
            if (!g.seeds.includes(f.seed)) g.seeds.push(f.seed);
            if (!g.positions.includes(placed)) g.positions.push(placed);
            const size = reproSize(f);
            const held = reproSize(g.sample);
            if (size < held || (size === held && f.seed < g.sample.seed)) g.sample = f;
        }
    }
    return [...groups.values()].sort(
        (x, y) =>
            y.count - x.count ||
            x.ships.join('+').localeCompare(y.ships.join('+')) ||
            x.kind.localeCompare(y.kind)
    );
}

export interface LedgerJson {
    compositionsRun: number;
    coverage: LedgerCoverage;
    calibrationResidual: CalibrationResidual;
    blindSpots: readonly string[];
    confirmed: Finding[];
    /** Differential findings a drift rule demoted (`Finding.drift`). */
    drift: Finding[];
    needsTriage: Finding[];
    /** Each tier grouped by (ships, kind) — see `tierGroups`. */
    groups: { confirmed: FindingGroup[]; drift: FindingGroup[]; needsTriage: FindingGroup[] };
    // Reserved for future use: nothing currently produces a "refuted" Finding (there's no
    // re-triage workflow yet that would move a needsTriage entry here), so this is always `[]`.
    // Kept in the shape rather than dropped since ledger consumers (docs/interaction-audit-
    // ledger.json readers) may already expect the field to exist.
    refuted: Finding[];
}

interface Tiers {
    confirmed: Finding[];
    drift: Finding[];
    needsTriage: Finding[];
}

/** Ablation → needsTriage, a demoted differential → drift, everything else → confirmed. */
function splitTiers(findings: readonly Finding[]): Tiers {
    return {
        confirmed: findings.filter((f) => f.oracle !== 'ablation' && !f.drift),
        drift: findings.filter((f) => f.oracle !== 'ablation' && f.drift),
        needsTriage: findings.filter((f) => f.oracle === 'ablation'),
    };
}

/**
 * Each tier grouped. A (ships, kind) with even ONE confirmed finding stays a confirmed group and
 * carries its demoted siblings' reason counts in `drift`; only a (ships, kind) whose every finding
 * was demoted is listed under drift. A group is not single-cause, so one surviving finding is
 * enough to keep it in front of a reader.
 */
export function tierGroups(tiers: Tiers): LedgerJson['groups'] {
    const confirmed = groupFindings(tiers.confirmed);
    const byKey = new Map(confirmed.map((g) => [`${g.ships.join('+')}|${g.kind}`, g] as const));
    const drift: FindingGroup[] = [];
    for (const g of groupFindings(tiers.drift)) {
        const held = byKey.get(`${g.ships.join('+')}|${g.kind}`);
        if (!held) {
            drift.push(g);
            continue;
        }
        for (const [reason, n] of Object.entries(g.drift ?? {}) as [DriftReason, number][]) {
            held.drift = { ...held.drift, [reason]: (held.drift?.[reason] ?? 0) + n };
        }
    }
    return { confirmed, drift, needsTriage: groupFindings(tiers.needsTriage) };
}

/** Pure function: builds the ledger JSON structure. */
export function buildLedgerJson(findings: Finding[], meta: LedgerMeta): LedgerJson {
    const tiers = splitTiers(findings);
    return {
        compositionsRun: meta.compositionsRun,
        coverage: meta.coverage,
        calibrationResidual: meta.calibrationResidual,
        blindSpots: LEDGER_BLIND_SPOTS,
        ...tiers,
        groups: tierGroups(tiers),
        refuted: [],
    };
}

const driftNote = (drift: FindingGroup['drift']): string =>
    Object.entries(drift ?? {})
        .map(([reason, n]) => `${reason}×${n}`)
        .join(', ');

/**
 * Pure function: renders the ledger as human-readable markdown.
 * Header with counts, then sections for confirmed, drift and needs-triage findings.
 */
export function renderLedgerMarkdown(findings: Finding[], meta: LedgerMeta): string {
    const tiers = splitTiers(findings);
    const groups = tierGroups(tiers);

    const lines: string[] = [];

    // Header with counts
    lines.push('# Interaction Audit Ledger');
    lines.push('');
    lines.push(`- Compositions run: **${meta.compositionsRun}**`);
    lines.push(
        `- Confirmed findings: **${tiers.confirmed.length}** in **${groups.confirmed.length}** (ships, kind) group(s)`
    );
    lines.push(
        `- Drift findings: **${tiers.drift.length}**, **${groups.drift.length}** (ships, kind) group(s) with no confirmed finding`
    );
    lines.push(
        `- Findings needing triage: **${tiers.needsTriage.length}** in **${groups.needsTriage.length}** (ships, kind) group(s)`
    );
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

    if (groups.confirmed.length > 0) {
        lines.push('## Confirmed');
        lines.push('');
        for (const g of groups.confirmed) lines.push(renderGroup(g));
    }

    if (groups.drift.length > 0) {
        lines.push('## Drift');
        lines.push('');
        lines.push(
            '`timing`: the other arm shows the kind within `TIMING_SLACK_ROUNDS` past the window. ' +
                '`filler`: a second draw of stand-in allies does not reproduce the diff.'
        );
        lines.push('');
        for (const g of groups.drift) lines.push(renderGroup(g));
    }

    if (groups.needsTriage.length > 0) {
        lines.push('## Needs Triage');
        lines.push('');
        for (const g of groups.needsTriage) lines.push(renderGroup(g));
    }

    return lines.join('\n');
}

/** One group: its key and spread, then its sample finding's payload. */
function renderGroup(group: FindingGroup): string {
    const finding = group.sample;
    const lines: string[] = [];

    lines.push(`### ${group.ships.join(', ')}: ${group.kind} (×${group.count})`);
    lines.push('');
    lines.push(`**Oracle:** ${group.oracle}`);
    lines.push(`**Severity:** ${finding.severity}`);
    lines.push(`**Seeds:** ${group.seeds.join(', ')}`);
    lines.push(`**Positions:** ${group.positions.join('; ')}`);
    if (group.drift) lines.push(`**Demoted:** ${driftNote(group.drift)}`);
    lines.push('');
    lines.push(`Sample (seed ${finding.seed}, positions ${finding.slots.join(', ')}):`);
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
