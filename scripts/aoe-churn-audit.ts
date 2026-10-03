/* eslint-disable no-console */
/**
 * AoE fan-out churn audit — reconciles a moved `realKitFingerprints` golden with the AoE census.
 *
 * Usage:
 *   npx tsx scripts/aoe-churn-audit.ts <effect-type>... [options]
 *
 *   effect types (census sections): debuff control dot shield-strip charge purge buff-steal
 *     detonate-dot. `control` covers both the control-status and control tables.
 *
 *   --base <ref>          git ref holding the baseline snapshot (default origin/main)
 *   --base-snap <file>    read the baseline snapshot from a file instead of git
 *   --head-snap <file>    the snapshot under audit (default: the working-tree golden)
 *   --census <file>       census markdown (default docs/superpowers/specs/2026-10-03-aoe-fanout-census.md)
 *   --min-footprint <n>   enemies a fixture cast must strike to expect churn (default 2)
 *   --include-cond        treat COND (per-victim condition) rows as defects too
 *
 * Output:
 *   (a) churned ships that have NO census row for the given effect types — every one is a finding.
 *   (b) census DEFECT / OVER-REACH ships of those types whose fingerprint fixture strikes at least
 *       `--min-footprint` enemies with the defect slot, yet did NOT churn. Split by a direct
 *       measurement on the CURRENT tree — the most distinct enemies the effect's own log entries
 *       name in one cast of that slot:
 *         (b1) still reaches at most one enemy  → finding: the fix did not reach this ship;
 *         (b2) already reaches several enemies  → note: fixed, but the fingerprint cannot show it.
 *       An OVER-REACH row (charge removal draining the whole roster) inverts the test: (b1) while
 *       the effect reaches MORE ships than the cast struck; otherwise (b?), because staying inside
 *       the struck set only proves the fix if an un-struck enemy had charge to lose.
 *   (b?) census defect rows the fixture cannot decide — a damage-less cast (no `attack` row, so no
 *        struck set) or an OVER-REACH row inside its struck set — a human checks these.
 *   Exit code 1 when (a), (b1) or (b?) is non-empty.
 *
 *   Effect reach is read per census row: a debuff/control row counts only log rows naming its own
 *   status, a DoT row only its own DoT type. A shield strip logs no row of its own, so its reach is
 *   "n/a" and it stays in (b1) for a human to check.
 *
 * Why (b2) exists: a fingerprint is the SET of distinct `kind[:slot]` tokens the focus produced
 * (`fingerprint.ts`). A debuff landing on three enemies instead of one adds no new kind, so a
 * correct fan-out often moves nothing. The snapshot alone cannot prove a fix reached a ship; the
 * victim count can.
 *
 * The struck count is the engine's own answer, not geometry re-derived here: the fixture battle is
 * run (`buildScenarioBattle` + `runSeededBattle`, exactly as the golden suite does) and the struck
 * set of a cast is the distinct targets of the focus's top-level `attack` entries in that turn.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildTraceShip } from './lib/traceShipFactory';
import {
    buildScenarioBattle,
    scenariosFor,
    FOCUS_ACTOR_ID,
    SEED,
} from '../src/utils/combat/audit/kitFingerprintScenarios';
import { runSeededBattle } from '../src/utils/simulator/seededRuns';
import type {
    CombatLogEntry,
    CombatLogEntryKind,
    CombatLogTurn,
} from '../src/utils/combat/log/types';

const SNAP_PATH = 'src/utils/calculators/__tests__/__snapshots__/realKitFingerprints.test.ts.snap';
const DEFAULT_CENSUS = 'docs/superpowers/specs/2026-10-03-aoe-fanout-census.md';

/** Census table section(s) each CLI effect type reads. */
const SECTIONS: Record<string, string[]> = {
    debuff: ['debuff'],
    control: ['control-status', 'control'],
    dot: ['dot'],
    'shield-strip': ['shield-strip'],
    charge: ['charge'],
    purge: ['purge'],
    'buff-steal': ['buff-steal'],
    'detonate-dot': ['detonate-dot'],
};

/** Log entry kinds that name an effect type's recipients. Empty = the effect logs no row. */
const EFFECT_KINDS: Record<string, CombatLogEntryKind[]> = {
    debuff: ['debuff', 'debuff-resisted'],
    control: ['debuff', 'debuff-resisted', 'control'],
    dot: ['dot-applied', 'debuff-resisted'],
    'shield-strip': [],
    // Read from `chargeLosers` instead: a charge row is booked to the ship that LOST the charge.
    charge: [],
    purge: ['purge'],
    'buff-steal': ['steal'],
    'detonate-dot': ['detonation'],
};

interface Args {
    types: string[];
    base: string;
    baseSnap?: string;
    headSnap: string;
    census: string;
    minFootprint: number;
    includeCond: boolean;
}

function parseArgs(argv: string[]): Args {
    const out: Args = {
        types: [],
        base: 'origin/main',
        headSnap: SNAP_PATH,
        census: DEFAULT_CENSUS,
        minFootprint: 2,
        includeCond: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${a} needs a value`);
            return v;
        };
        if (a === '--base') out.base = next();
        else if (a === '--base-snap') out.baseSnap = next();
        else if (a === '--head-snap') out.headSnap = next();
        else if (a === '--census') out.census = next();
        else if (a === '--min-footprint') out.minFootprint = Number(next());
        else if (a === '--include-cond') out.includeCond = true;
        else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
        else out.types.push(a);
    }
    if (out.types.length === 0) throw new Error('name at least one effect type');
    for (const t of out.types) {
        if (!SECTIONS[t]) {
            throw new Error(
                `unknown effect type '${t}' (known: ${Object.keys(SECTIONS).join(', ')})`
            );
        }
    }
    return out;
}

// ── snapshot ────────────────────────────────────────────────────────────────────────────────

type Fingerprint = Record<string, string[]>;

/** `kit fingerprints > <Ship> 1` entries → ship → scenario → tokens. */
function parseSnapshot(text: string): Map<string, Fingerprint> {
    const out = new Map<string, Fingerprint>();
    const entry = /^exports\[`kit fingerprints > (.+?) 1`\] = `\n([\s\S]*?)\n`;$/gm;
    let m: RegExpExecArray | null;
    while ((m = entry.exec(text)) !== null) {
        const fp: Fingerprint = {};
        let scenario: string | null = null;
        for (const line of m[2].split('\n')) {
            const head = /^\s*"([^"]+)": \[$/.exec(line);
            if (head) {
                scenario = head[1];
                fp[scenario] = [];
                continue;
            }
            const token = /^\s*"([^"]+)",$/.exec(line);
            if (token && scenario) fp[scenario].push(token[1]);
        }
        out.set(m[1], fp);
    }
    if (out.size === 0) throw new Error('no kit fingerprint entries found in the snapshot');
    return out;
}

function readBaseSnapshot(args: Args): string {
    if (args.baseSnap) return readFileSync(args.baseSnap, 'utf8');
    return execFileSync('git', ['show', `${args.base}:${SNAP_PATH}`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
}

/** Per-scenario token delta between two fingerprints; empty when identical. */
function fingerprintDelta(base: Fingerprint | undefined, head: Fingerprint | undefined): string[] {
    if (!base || !head) return [base ? 'entry removed' : 'entry added'];
    const out: string[] = [];
    for (const scenario of new Set([...Object.keys(base), ...Object.keys(head)])) {
        const b = new Set(base[scenario] ?? []);
        const h = new Set(head[scenario] ?? []);
        const added = [...h].filter((t) => !b.has(t));
        const removed = [...b].filter((t) => !h.has(t));
        if (added.length || removed.length) {
            out.push(
                `${scenario}: ${[...added.map((t) => `+${t}`), ...removed.map((t) => `-${t}`)].join(' ')}`
            );
        }
    }
    return out;
}

// ── census ──────────────────────────────────────────────────────────────────────────────────

interface CensusRow {
    section: string;
    ship: string;
    slot: 'active' | 'charged';
    cls: string;
    effect: string;
}

function parseCensus(text: string): CensusRow[] {
    const rows: CensusRow[] = [];
    let section: string | null = null;
    for (const line of text.split('\n')) {
        const heading = /^###\s+([a-z-]+)\s+\(/.exec(line);
        if (heading) {
            section = heading[1];
            continue;
        }
        if (/^#{1,3}\s/.test(line)) {
            section = null;
            continue;
        }
        if (!section || !line.startsWith('| ')) continue;
        const cells = line
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());
        if (cells[0] === 'Ship' || /^-+$/.test(cells[0])) continue;
        const [ship, slot, , effect, , cls] = cells;
        if (slot !== 'active' && slot !== 'charged') continue;
        rows.push({ section, ship, slot, cls, effect });
    }
    return rows;
}

const isDefectClass = (cls: string, includeCond: boolean) =>
    cls.startsWith('DEFECT') ||
    cls.startsWith('OVER-REACH') ||
    (includeCond && cls.startsWith('COND'));

// ── fixture measurement ─────────────────────────────────────────────────────────────────────

/** One focus cast in a fixture battle: which slot fired and its own top-level log rows. */
interface CastRecord {
    slot: 'active' | 'charged';
    rows: { kind: CombatLogEntryKind; note: string; targetIds: string[] }[];
    /** Other ships whose charge meter the cast lowered (`charge-changed` rows, `manip` reason). */
    chargeLosers: Set<string>;
}

/** "charge 3→1 (manip)" → true when the meter went down. */
const isChargeLoss = (note: string | undefined): boolean => {
    const m = /charge (\d+)→(\d+) \(manip\)/.exec(note ?? '');
    return m !== null && Number(m[2]) < Number(m[1]);
};

function collectChargeLosers(entries: readonly CombatLogEntry[], out: Set<string>): void {
    for (const e of entries) {
        if (e.kind === 'charge-changed' && e.actorId !== FOCUS_ACTOR_ID && isChargeLoss(e.note)) {
            out.add(e.actorId);
        }
        if (e.reactions?.length) collectChargeLosers(e.reactions, out);
    }
}

/** Which skill a focus turn fired: the cast's slot tag if any entry carries it, else the charge
 *  meter (a full meter at turn start fires the charged skill). */
function turnSlot(turn: CombatLogTurn): 'active' | 'charged' {
    const tagged = turn.entries.find((e) => e.actorId === FOCUS_ACTOR_ID && e.slot);
    if (tagged?.slot) return tagged.slot;
    return turn.chargeMax > 0 && turn.chargeBefore >= turn.chargeMax ? 'charged' : 'active';
}

/** Every focus cast across the ship's fixture battles (top-level turn entries only, so a nested
 *  reaction is not counted as the cast's own reach). */
function fixtureCasts(name: string): CastRecord[] | null {
    const ship = buildTraceShip(name);
    if (!ship) return null;
    const casts: CastRecord[] = [];
    for (const scenario of scenariosFor(ship)) {
        const result = runSeededBattle(buildScenarioBattle(ship, scenario), SEED);
        for (const round of result.combatLog) {
            for (const turn of round.turns) {
                if (turn.actorId !== FOCUS_ACTOR_ID) continue;
                const rows = turn.entries
                    .filter((e) => e.actorId === FOCUS_ACTOR_ID)
                    .map((e) => ({
                        kind: e.kind,
                        note: e.note ?? '',
                        targetIds: e.targets.map((t) => t.targetId),
                    }));
                const chargeLosers = new Set<string>();
                collectChargeLosers(turn.entries, chargeLosers);
                casts.push({ slot: turnSlot(turn), rows, chargeLosers });
            }
        }
    }
    return casts;
}

/** Most distinct targets the given kinds named in one cast of `slot`. With `name`, only rows whose
 *  note names it count (a debuff/resist row's note is the status name, a DoT row's names its type),
 *  so a ship's other debuffs do not stand in for the census row's own effect. */
function maxReach(
    casts: readonly CastRecord[],
    slot: 'active' | 'charged',
    kinds: readonly CombatLogEntryKind[],
    name?: string
): number {
    const needle = name?.toLowerCase().replace(/-/g, ' ');
    let best = 0;
    for (const c of casts) {
        if (c.slot !== slot) continue;
        const ids = new Set<string>();
        for (const row of c.rows) {
            if (!kinds.includes(row.kind)) continue;
            if (needle && !row.note.toLowerCase().includes(needle)) continue;
            for (const id of row.targetIds) ids.add(id);
        }
        best = Math.max(best, ids.size);
    }
    return best;
}

/** The census Effect cell as a status/DoT name, or undefined when it is not one ("None", a count). */
const effectName = (effect: string): string | undefined =>
    /[a-z]/i.test(effect) && effect !== 'None' ? effect : undefined;

// ── main ────────────────────────────────────────────────────────────────────────────────────

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const base = parseSnapshot(readBaseSnapshot(args));
    const head = parseSnapshot(readFileSync(args.headSnap, 'utf8'));
    const census = parseCensus(readFileSync(args.census, 'utf8'));

    const sections = new Set(args.types.flatMap((t) => SECTIONS[t]));
    const typeRows = census.filter((r) => sections.has(r.section));
    if (typeRows.length === 0) throw new Error(`census has no rows for ${args.types.join(', ')}`);
    const censusShips = new Set(typeRows.map((r) => r.ship));

    const churned = new Map<string, string[]>();
    for (const ship of new Set([...base.keys(), ...head.keys()])) {
        const delta = fingerprintDelta(base.get(ship), head.get(ship));
        if (delta.length) churned.set(ship, delta);
    }

    console.log(`AoE churn audit — types: ${args.types.join(', ')}`);
    console.log(
        `baseline: ${args.baseSnap ?? `${args.base}:${SNAP_PATH}`}  head: ${args.headSnap}`
    );
    console.log(
        `${churned.size} churned fingerprint(s); ${censusShips.size} census ship(s) for these types\n`
    );

    // (a)
    const unexplained = [...churned].filter(([ship]) => !censusShips.has(ship));
    console.log(`(a) churned but NOT in the census for these types: ${unexplained.length}`);
    for (const [ship, delta] of unexplained) console.log(`  ${ship}\n    ${delta.join('\n    ')}`);
    const explained = [...churned].filter(([ship]) => censusShips.has(ship));
    if (explained.length) {
        console.log(`\n    churned AND in the census (explained): ${explained.length}`);
        for (const [ship, delta] of explained) {
            console.log(`      ${ship}: ${delta.join(' | ')}`);
        }
    }

    // (b)
    const defects = typeRows.filter((r) => isDefectClass(r.cls, args.includeCond));
    const b1: string[] = [];
    const b2: string[] = [];
    const belowFootprint: string[] = [];
    const unmeasured: string[] = [];
    const unresolved = new Set<string>();
    const castCache = new Map<string, CastRecord[] | null>();
    const seen = new Set<string>();
    for (const r of [...defects].sort((a, b) => a.ship.localeCompare(b.ship))) {
        if (churned.has(r.ship)) continue;
        const key = `${r.ship}|${r.slot}|${r.section}|${r.effect}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!castCache.has(r.ship)) castCache.set(r.ship, fixtureCasts(r.ship));
        const casts = castCache.get(r.ship);
        if (!casts) {
            unresolved.add(r.ship);
            continue;
        }
        const type = Object.keys(SECTIONS).find((t) => SECTIONS[t].includes(r.section))!;
        const kinds = EFFECT_KINDS[type];
        const struck = maxReach(casts, r.slot, ['attack']);
        const reach =
            type === 'charge'
                ? Math.max(
                      0,
                      ...casts.filter((c) => c.slot === r.slot).map((c) => c.chargeLosers.size)
                  )
                : kinds.length
                  ? maxReach(casts, r.slot, kinds, effectName(r.effect))
                  : undefined;
        const line = `${r.ship} ${r.slot} [${r.section} ${r.effect}]: fixture strikes ${struck}, effect reaches ${
            reach ?? 'n/a (logs no row)'
        }`;
        // A cast with no `attack` row deals no damage, so the struck set is unmeasured, not empty.
        if (struck === 0) unmeasured.push(line);
        else if (r.cls.startsWith('OVER-REACH')) {
            // The defect is reaching TOO FAR. Reaching past the struck set proves it is still there;
            // staying inside proves nothing unless an un-struck enemy had charge to lose, which the
            // fixture does not guarantee — so that case is unmeasured, never "fixed".
            if (reach !== undefined && reach > struck) b1.push(line);
            else unmeasured.push(`${line} (cannot show the over-reach is gone)`);
        } else if (struck < args.minFootprint) belowFootprint.push(line);
        else if (reach !== undefined && reach >= 2) b2.push(line);
        else b1.push(line);
    }
    console.log(
        `\n(b1) census defect, fixture strikes >= ${args.minFootprint}, NOT churned, effect still reaches <= 1: ${b1.length}`
    );
    for (const l of b1) console.log(`  ${l}`);
    console.log(
        `\n(b2) census defect, fixture strikes >= ${args.minFootprint}, NOT churned, effect measured on several (fingerprint cannot show fan-out): ${b2.length}`
    );
    for (const l of b2) console.log(`  ${l}`);
    console.log(
        `\n    census defect, fixture strikes < ${args.minFootprint} (no churn expected): ${belowFootprint.length}`
    );
    for (const l of belowFootprint) console.log(`      ${l}`);
    console.log(
        `\n(b?) census defect the fixture cannot decide (no attack row, or over-reach not shown): ${unmeasured.length}`
    );
    for (const l of unmeasured) console.log(`  ${l}`);
    if (unresolved.size) console.log(`\n    not in the corpus: ${[...unresolved].join(', ')}`);

    const clean = unexplained.length === 0 && b1.length === 0 && unmeasured.length === 0;
    console.log(`\n${clean ? 'CLEAN' : 'FINDINGS'}`);
    process.exitCode = clean ? 0 : 1;
}

main();
