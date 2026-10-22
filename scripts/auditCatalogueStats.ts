/* eslint-disable no-console */
/**
 * Audits the stats a unit enters a simulated fight with against the official catalogue
 * (`docs/catalogue-units.json`). Writes `docs/catalogue-stats-ledger.{json,md}`.
 *
 * Usage: npm run audit:catalogue-stats [-- --inject <drop-innate|swap-hp-attack|drop-refit-5|swap-affinity>]
 * `--inject` plants a deliberate fault and does not write the ledger; the run must report it.
 */
import fs from 'fs';
import path from 'path';
import { catalogueUnitSchema, type CatalogueUnit } from './lib/catalogueSchema';
import {
    auditUnits,
    INJECTIONS,
    STAT_KEYS,
    type AuditResult,
    type Injection,
    type Mismatch,
} from './lib/catalogueStatsAudit';
import { loadShipDataRecords, shipDataAvailable } from './lib/shipDataSnapshot';

const DOCS = path.join(process.cwd(), 'docs');
const UNITS_PATH = path.join(DOCS, 'catalogue-units.json');

interface SnapshotDrift {
    unit: string;
    field: string;
    snapshot: number | string;
    catalogue: number | string;
}

const SNAPSHOT_FIELDS: [string, (u: CatalogueUnit) => number | string][] = [
    ['hp', (u) => Math.round(u.stats.HullPoints)],
    ['attack', (u) => Math.round(u.stats.Power)],
    ['defense', (u) => Math.round(u.stats.Defense)],
    ['hacking', (u) => Math.round(u.stats.Manipulation)],
    ['security', (u) => Math.round(u.stats.Security)],
    ['critRate', (u) => Math.round(u.stats.CritChance * 100)],
    ['critDamage', (u) => Math.round(u.stats.CritBoost * 100)],
    ['speed', (u) => Math.round(u.stats.Initiative)],
];

/** `docs/ship-data.json` (the trace/audit corpus) has no definition id, so it is name-joined and reported separately. */
const snapshotDrift = (units: CatalogueUnit[]) => {
    const records = shipDataAvailable() ? loadShipDataRecords() : [];
    const byName = new Map(records.map((r) => [r.name.toUpperCase(), r]));
    const drift: SnapshotDrift[] = [];
    const missingFromSnapshot: string[] = [];
    for (const unit of units) {
        const rec = byName.get(unit.name.toUpperCase());
        if (!rec) {
            missingFromSnapshot.push(unit.name);
            continue;
        }
        const r = rec as unknown as Record<string, number | string>;
        for (const [field, read] of SNAPSHOT_FIELDS) {
            if (r[field] !== read(unit)) {
                drift.push({ unit: unit.name, field, snapshot: r[field], catalogue: read(unit) });
            }
        }
    }
    const names = new Set(units.map((u) => u.name.toUpperCase()));
    const extraInSnapshot = records
        .filter((r) => !names.has(r.name.toUpperCase()))
        .map((r) => r.name);
    return { drift, missingFromSnapshot, extraInSnapshot, snapshotCount: records.length };
};

const group = (mismatches: Mismatch[]) => {
    const groups = new Map<string, Mismatch[]>();
    for (const m of mismatches) {
        const key = `${m.kind} / ${m.field}`;
        groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return groups;
};

const renderMarkdown = (
    result: AuditResult,
    snap: ReturnType<typeof snapshotDrift>,
    build: string
): string => {
    const total = result.unitCount * 7;
    const lines = [
        '# Catalogue stats ledger',
        '',
        `Catalogue build ${build}. Coverage: ${result.compared}/${total} unit x refit combinations compared ` +
            `(${result.unitCount} units x refits 0..6; ${result.skipped} not constructible via the reference path), ` +
            `${STAT_KEYS.length} stats each, plus ${result.metaCompared} affinity/role/faction/rarity checks. ` +
            `Level 60, rank 0, no gear.`,
        '',
        `Mismatches: ${result.mismatches.filter((m) => m.kind === 'mismatch').length}; ` +
            `rounding-only (off by 1): ${result.mismatches.filter((m) => m.kind === 'rounding').length}.`,
        '',
        '## Pipeline mismatches',
        '',
    ];
    if (result.mismatches.length === 0) lines.push('None.', '');
    for (const [key, list] of group(result.mismatches)) {
        lines.push(`### ${key} (${list.length})`, '');
        for (const m of list.slice(0, 60)) {
            lines.push(
                `- ${m.unit} (${m.definitionId}) refit ${m.refits}: ours ${m.ours}, catalogue ${m.catalogue}${m.note ? ` [${m.note}]` : ''}`
            );
        }
        if (list.length > 60) lines.push(`- ... ${list.length - 60} more in the JSON ledger`);
        lines.push('');
    }
    lines.push(
        '## docs/ship-data.json snapshot vs catalogue (name-joined)',
        '',
        `Snapshot units ${snap.snapshotCount}; drifted fields ${snap.drift.length}; ` +
            `missing from snapshot ${snap.missingFromSnapshot.length}; extra in snapshot ${snap.extraInSnapshot.length}.`,
        ''
    );
    for (const d of snap.drift.slice(0, 80)) {
        lines.push(`- ${d.unit} ${d.field}: snapshot ${d.snapshot}, catalogue ${d.catalogue}`);
    }
    if (snap.missingFromSnapshot.length) {
        lines.push('', `Missing: ${snap.missingFromSnapshot.join(', ')}`);
    }
    if (snap.extraInSnapshot.length) lines.push('', `Extra: ${snap.extraInSnapshot.join(', ')}`);
    return lines.join('\n') + '\n';
};

function main(): void {
    if (!fs.existsSync(UNITS_PATH)) {
        console.error('docs/catalogue-units.json is missing (gitignored reference data).');
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(UNITS_PATH, 'utf8')) as {
        manifest: { build: string };
        units: unknown[];
    };
    const units = raw.units.map((u) => catalogueUnitSchema.parse(u));

    const injectIdx = process.argv.indexOf('--inject');
    const injection = (injectIdx >= 0 ? process.argv[injectIdx + 1] : 'none') as Injection;
    if (injection !== 'none' && !INJECTIONS.includes(injection)) {
        console.error(`Unknown injection "${injection}"; use one of ${INJECTIONS.join(', ')}.`);
        process.exit(2);
    }

    const result = auditUnits(units, injection);
    if (injection !== 'none') {
        const real = result.mismatches.filter((m) => m.kind !== 'rounding');
        console.log(`INJECTED ${injection}: ${real.length} mismatches reported (must be > 0).`);
        process.exit(real.length > 0 ? 0 : 1);
    }

    const snap = snapshotDrift(units);
    const build = raw.manifest.build;
    fs.writeFileSync(
        path.join(DOCS, 'catalogue-stats-ledger.json'),
        JSON.stringify(
            {
                build,
                coverage: {
                    compared: result.compared,
                    total: result.unitCount * 7,
                    skipped: result.skipped,
                    metaCompared: result.metaCompared,
                },
                mismatches: result.mismatches,
                snapshot: snap,
            },
            null,
            2
        ) + '\n'
    );
    fs.writeFileSync(
        path.join(DOCS, 'catalogue-stats-ledger.md'),
        renderMarkdown(result, snap, build)
    );
    console.log(
        `compared ${result.compared}/${result.unitCount * 7}; mismatches ${result.mismatches.length}; snapshot drift ${snap.drift.length}`
    );
}

main();
