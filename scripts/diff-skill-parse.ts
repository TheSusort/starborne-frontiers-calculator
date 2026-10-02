/* eslint-disable no-console */
/**
 * Parse diff between two skill corpora (see scripts/lib/skillParseDiff.ts).
 *
 * Usage:
 *   npm run diff:skill-parse                         # docs/ship-skills.csv → docs/ship-skills.catalogue.csv
 *   npm run diff:skill-parse -- --from A.csv --to B.csv [--json out.json] [--all]
 *   npm run diff:skill-parse -- --dump out.json      # snapshot how --from parses (no comparison)
 *   npm run diff:skill-parse -- --against dump.json  # compare --from's parse NOW to a dump
 *   npm run diff:skill-parse -- --fixtures "Gallant:passive:0,Faust:passive:2"   # paste-ready RewordPairs
 *
 * Prints a summary and every structural / config-changed row (all rows with --all).
 */
import { readFileSync, writeFileSync } from 'fs';
import { buildTraceShip } from './lib/traceShipFactory';
import { loadShipSkillRecords, type ShipSkillRecord } from './lib/shipSkillCsv';
import { canonicalAbilities, diffCorpora, summarizeDiff } from './lib/skillParseDiff';
import { slotParser } from './lib/skillSlotParser';
import { flagValue } from './lib/cliArgs';

const argv = process.argv;
const from = flagValue(argv, '--from') ?? 'docs/ship-skills.csv';
const to = flagValue(argv, '--to') ?? 'docs/ship-skills.catalogue.csv';

// The base ship (role, stats) comes from docs/ship-data.json, falling back to docs/ship-skills.csv.
const parse = slotParser((name, refit) => {
    const base = buildTraceShip(name, { refitLevel: refit });
    if (!base) throw new Error(`no trace ship for ${name}`);
    return base;
});

const dumpOf = (recs: ShipSkillRecord[]) => {
    const out: Record<string, string> = {};
    for (const r of recs) for (const refit of [0, 2, 4] as const) {
        const p = parse(r, refit);
        for (const slot of ['active', 'charged', 'passive'] as const) out[`${r.name}:${slot}:${refit}`] = canonicalAbilities(p[slot]);
    }
    return out;
};

const fromRecs = loadShipSkillRecords(from);
const dumpPath = flagValue(argv, '--dump');
const againstPath = flagValue(argv, '--against');
const fixtures = flagValue(argv, '--fixtures');

if (dumpPath) {
    writeFileSync(dumpPath, JSON.stringify(dumpOf(fromRecs), null, 1));
    console.log(`Dumped ${fromRecs.length} ships' parse to ${dumpPath}`);
} else if (againstPath) {
    const before: Record<string, string> = JSON.parse(readFileSync(againstPath, 'utf8'));
    const now = dumpOf(fromRecs);
    const changed = Object.keys({ ...before, ...now }).filter((k) => before[k] !== now[k]);
    console.log(`${changed.length} slot parses changed vs ${againstPath}`);
    for (const k of changed) console.log(`  ${k}`);
    process.exitCode = changed.length ? 1 : 0;
} else {
    const toRecs = loadShipSkillRecords(to);
    const rows = diffCorpora(fromRecs, toRecs, parse);
    if (fixtures) {
        for (const key of fixtures.split(',')) {
            const parts = key.split(':');
            const refit = parts.pop();
            const slot = parts.pop();
            const ship = parts.join(':');
            const r = rows.find((x) => x.name === ship && x.slot === slot && String(x.refit) === refit);
            if (!r) { console.log(`// ${key}: no row`); continue; }
            console.log(`{ ship: ${JSON.stringify(ship)}, slot: '${slot}', old: ${JSON.stringify(r.currentText)}, new: ${JSON.stringify(r.candidateText)}, expects: ${JSON.stringify(r.lost[0] ?? '')} },`);
        }
    } else {
        const jsonPath = flagValue(argv, '--json');
        if (jsonPath) writeFileSync(jsonPath, JSON.stringify(rows, null, 1));
        console.log(JSON.stringify(summarizeDiff(rows), null, 1));
        const shown = argv.includes('--all') ? rows : rows.filter((r) => r.structural || r.configChanged || r.kind === 'missing');
        for (const r of shown) {
            console.log(`\n## ${r.name} ${r.slot} R${r.refit} [${r.kind}${r.structural ? ' STRUCT' : r.configChanged ? ' config' : ''}]`);
            if (r.lost.length) console.log(`  - ${r.lost.join(' ; ')}`);
            if (r.gained.length) console.log(`  + ${r.gained.join(' ; ')}`);
        }
    }
}
