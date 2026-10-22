/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { parseAuditArgs } from './lib/auditArgs';
import { loadTaggedCorpus } from './lib/taggedCorpus';
import { composeBattle } from '../src/utils/combat/audit/compose';
import {
    runMirrorPair,
    withSpeedNudge,
    type MirrorClass,
    type MirrorDivergence,
    type MirrorKindDiff,
} from '../src/utils/combat/audit/sideMirror';
import type { CombatLogEntry } from '../src/utils/combat/log/types';

/**
 * Side-mirror differential (`npm run audit:side-mirror -- --seed <N> --count <M>`): every
 * composition `composeBattle` draws for seeds N..N+M-1 is fought twice — as drawn, and with the
 * teams swapped — under per-ship paired RNG streams, and the two fights are compared. See
 * `src/utils/combat/audit/sideMirror.ts` for the pairing and the classes.
 *
 * Writes docs/side-mirror-ledger.{json,md}. Coverage is the headline: a pair is COMPARABLE unless
 * the documented cross-team speed tie decided its first divergence.
 */

const LEDGER_DIR = path.join(process.cwd(), 'docs');

/** A composition whose pair is decided by a cross-team speed tie is retried with the ship that
 *  won the tie in the original arm made this much faster, so the pair becomes comparable instead
 *  of dropping out of coverage. A fight can tie again later (speed buffs), hence a retry cap. */
const TIE_NUDGE = 0.01;
const MAX_TIE_NUDGES = 3;

interface PairRecord {
    seed: number;
    class: MirrorClass;
    roundCap: boolean;
    stateMirrored: boolean;
    ships: Record<string, { name: string; position: string }>;
    strict: MirrorDivergence | null;
    unordered: MirrorDivergence | null;
    kindDiffs: MirrorKindDiff[];
    /** Slot labels given a +TIE_NUDGE speed nudge, in order. `composeBattle(seed)` alone does not
     *  reproduce a nudged pair: apply `withSpeedNudge` for each label first. */
    nudges: string[];
}

interface Bucket {
    key: string;
    class: MirrorClass;
    seeds: number[];
    /** The bucket's seeds whose composition carries a speed nudge. */
    nudgedSeeds: number[];
    stateChanged: number;
    /** Ship names at the divergence, over every pair in the bucket. */
    ships: Record<string, number>;
    notes: Record<string, number>;
    sample: PairRecord;
}

function sectionType(d: MirrorDivergence): string {
    if (d.kind !== 'combat-log') return d.kind;
    return (d.section ?? 'unknown').split(':')[0];
}

function entryShape(json: string): { kind: string; note?: string } {
    if (json === '<none>') return { kind: '<none>' };
    try {
        const e = JSON.parse(json.replace(/…$/, '')) as { kind?: string; note?: string };
        return { kind: e.kind ?? 'header', note: e.note };
    } catch {
        return { kind: 'truncated' };
    }
}

/** The pattern a divergence belongs to: class, where in the log, which entry kinds, and whether
 *  the two entries came from ships on the same original side. */
function bucketKey(r: PairRecord, d: MirrorDivergence): string {
    const a = entryShape(d.original);
    const b = entryShape(d.swapped);
    const sides = new Set(d.actors.map((l) => l[0]));
    const span = d.actors.length < 2 ? 'one-ship' : sides.size === 2 ? 'cross-side' : 'same-side';
    return `${r.class} | ${sectionType(d)} | ${a.kind} vs ${b.kind} | ${span}`;
}

function main(): void {
    const args = parseAuditArgs(process.argv.slice(2));
    const tagged = loadTaggedCorpus();
    const started = performance.now();

    const records: PairRecord[] = [];
    let unkeyedDraws = 0;
    let unmappedKeyedDraws = 0;
    let errors = 0;
    let tiesBroken = 0;
    const classesById = new Map(tagged.map((t) => [t.ship.id, t.classes]));
    /** Comparable compositions containing at least one ship of each interaction class. Every
     *  composition is fought from both sides, so each count is also that class's enemy-side
     *  coverage. */
    const classCoverage: Record<string, number> = {};
    const kindsObserved = new Set<string>();
    for (let i = 0; i < args.count; i++) {
        const seed = args.seed + i;
        let input = composeBattle(seed, tagged);
        try {
            let pair = runMirrorPair(input, seed);
            const nudges: string[] = [];
            while (pair.verdict.class === 'speed-tie' && nudges.length < MAX_TIE_NUDGES) {
                const label = pair.verdict.unordered!.actors[0];
                input = withSpeedNudge(input, label, TIE_NUDGE);
                pair = runMirrorPair(input, seed);
                nudges.push(label);
            }
            if (nudges.length > 0 && pair.verdict.class !== 'speed-tie') tiesBroken++;
            unkeyedDraws += pair.stats.unkeyedDraws;
            unmappedKeyedDraws += pair.stats.unmappedKeyedDraws;
            const v = pair.verdict;
            if (v.class !== 'speed-tie') {
                const present = new Set<string>();
                for (const p of [...input.playerTeam, ...input.enemyTeam]) {
                    for (const c of classesById.get(p.ship.id) ?? []) present.add(c);
                }
                for (const c of present) classCoverage[c] = (classCoverage[c] ?? 0) + 1;
                for (const round of pair.original.combatLog) {
                    const walk = (entries: CombatLogEntry[]) => {
                        for (const e of entries) {
                            kindsObserved.add(e.kind);
                            walk(e.reactions ?? []);
                        }
                    };
                    walk(round.startOfRound);
                    for (const t of round.turns) walk(t.entries);
                    walk(round.endOfRound);
                }
            }
            records.push({
                seed,
                class: v.class,
                roundCap: v.roundCap,
                stateMirrored: v.stateMirrored,
                ships: pair.ships,
                strict: v.strict,
                unordered: v.unordered,
                kindDiffs: v.kindDiffs,
                nudges,
            });
        } catch (err) {
            errors++;
            console.error(`seed ${seed}: ${(err as Error).message}`);
        }
        if ((i + 1) % 100 === 0) console.log(`  ...${i + 1}/${args.count}`);
    }
    const runtimeMs = Math.round(performance.now() - started);

    const count = (c: MirrorClass) => records.filter((r) => r.class === c).length;
    const total = args.count;
    const comparable = records.length - count('speed-tie');
    const summary = {
        seed: args.seed,
        count: args.count,
        runtimeMs,
        coverage: { comparable, total },
        mirrored: count('mirrored'),
        logOrder: count('log-order'),
        behaviour: count('behaviour'),
        behaviourStateChanged: records.filter((r) => r.class === 'behaviour' && !r.stateMirrored)
            .length,
        speedTie: count('speed-tie'),
        tiesBroken,
        roundCap: records.filter((r) => r.roundCap).length,
        errors,
        unkeyedDraws,
        unmappedKeyedDraws,
        classCoverage,
        kindsObserved: [...kindsObserved].sort(),
    };

    const buckets = new Map<string, Bucket>();
    for (const r of records) {
        if (r.class === 'mirrored' || r.class === 'speed-tie') continue;
        const d = r.class === 'log-order' ? r.strict! : r.unordered!;
        const key = bucketKey(r, d);
        const b = buckets.get(key) ?? {
            key,
            class: r.class,
            seeds: [],
            nudgedSeeds: [],
            stateChanged: 0,
            ships: {},
            notes: {},
            sample: r,
        };
        b.seeds.push(r.seed);
        if (r.nudges.length > 0) b.nudgedSeeds.push(r.seed);
        if (!r.stateMirrored) b.stateChanged++;
        for (const label of d.actors) {
            const name = r.ships[label]?.name ?? label;
            b.ships[name] = (b.ships[name] ?? 0) + 1;
        }
        for (const side of [d.original, d.swapped]) {
            const note = entryShape(side).note;
            if (note) b.notes[note] = (b.notes[note] ?? 0) + 1;
        }
        buckets.set(key, b);
    }
    const sortedBuckets = [...buckets.values()].sort((x, y) => y.seeds.length - x.seeds.length);

    fs.writeFileSync(
        path.join(LEDGER_DIR, 'side-mirror-ledger.json'),
        `${JSON.stringify({ summary, buckets: sortedBuckets, pairs: records.filter((r) => r.class !== 'mirrored') }, null, 2)}\n`
    );
    fs.writeFileSync(
        path.join(LEDGER_DIR, 'side-mirror-ledger.md'),
        renderMarkdown(summary, sortedBuckets)
    );

    console.log('');
    console.log(`coverage:          ${formatCoverage(comparable, total)} compositions comparable`);
    console.log(`  mirrored:        ${summary.mirrored}`);
    console.log(
        `  log-order:       ${summary.logOrder} (finding: same events, side-dependent order)`
    );
    console.log(
        `  behaviour:       ${summary.behaviour} (${summary.behaviourStateChanged} changed the fight state)`
    );
    console.log(
        `  speed-tie:       ${summary.speedTie} (documented exception, not comparable; ` +
            `${tiesBroken} more made comparable by a speed nudge)`
    );
    console.log(`  round-cap:       ${summary.roundCap} (winner exempt; rest compared)`);
    console.log(`  errors:          ${errors}`);
    console.log(
        `rng pairing:       ${unkeyedDraws} un-keyed draws, ${unmappedKeyedDraws} unmapped keyed draws`
    );
    console.log(`runtime:           ${(runtimeMs / 1000).toFixed(1)} s`);
    console.log(`buckets:           ${sortedBuckets.length}`);
    for (const b of sortedBuckets)
        console.log(`  ${b.seeds.length.toString().padStart(4)}  ${b.key}`);
    console.log('');
    console.log('Ledger: docs/side-mirror-ledger.{json,md}');
}

function formatCoverage(comparable: number, total: number): string {
    const pct = total === 0 ? 0 : (100 * comparable) / total;
    return (
        `${comparable}/${total} (${pct.toFixed(1)}%)` +
        (comparable === 0 ? ' VACUOUS: compared nothing' : '')
    );
}

function renderMarkdown(
    s: {
        seed: number;
        count: number;
        runtimeMs: number;
        coverage: { comparable: number; total: number };
        mirrored: number;
        logOrder: number;
        behaviour: number;
        behaviourStateChanged: number;
        speedTie: number;
        roundCap: number;
        tiesBroken: number;
        errors: number;
        unkeyedDraws: number;
        unmappedKeyedDraws: number;
        classCoverage: Record<string, number>;
        kindsObserved: string[];
    },
    buckets: Bucket[]
): string {
    const lines: string[] = [];
    lines.push('# Side-mirror ledger');
    lines.push('');
    lines.push(
        `Seeds ${s.seed}..${s.seed + s.count - 1}, runtime ${(s.runtimeMs / 1000).toFixed(1)} s. ` +
            'Each composition is fought as drawn and with the teams swapped, with every ship drawing ' +
            'the same RNG stream in both arms.'
    );
    lines.push('');
    lines.push(
        `- Coverage: **${formatCoverage(s.coverage.comparable, s.coverage.total)}** compositions comparable`
    );
    lines.push(`- Mirrored exactly: **${s.mirrored}**`);
    lines.push(
        `- Log-order findings: **${s.logOrder}** (same events, side-dependent order; fight state mirrors)`
    );
    lines.push(
        `- Behaviour findings: **${s.behaviour}** (${s.behaviourStateChanged} changed turn order, ship state or outcome)`
    );
    lines.push(
        `- Speed tie (documented exception, excluded from coverage): **${s.speedTie}**; ` +
            `**${s.tiesBroken}** more were tied and made comparable by a +${TIE_NUDGE} speed nudge ` +
            'on the tie winner'
    );
    lines.push(`- Round cap reached (winner exempt, rest compared): **${s.roundCap}**`);
    lines.push(`- Errors: **${s.errors}**`);
    lines.push(
        `- RNG pairing: **${s.unkeyedDraws}** un-keyed draws, **${s.unmappedKeyedDraws}** keyed draws without an actor-id prefix`
    );
    const classes = Object.entries(s.classCoverage)
        .sort((x, y) => y[1] - x[1])
        .map(([c, n]) => `${c} ${n}`)
        .join(', ');
    lines.push(`- Interaction classes in comparable compositions: ${classes || 'none'}`);
    lines.push(`- Log kinds observed (${s.kindsObserved.length}): ${s.kindsObserved.join(', ')}`);
    lines.push('');
    lines.push('## Blind spots');
    lines.push('');
    lines.push(
        '- No squad leaders: `composeBattle` sets none, so the leader swap is never exercised.'
    );
    lines.push(
        '- Canonical un-geared base stats: gear sets, implants and refits are not in the fight.'
    );
    lines.push(
        '- One RNG seed per composition; the pairing makes that seed a verdict for THIS draw, not ' +
            'for every draw the composition could make.'
    );
    lines.push('');
    lines.push('## Findings by pattern');
    lines.push('');
    if (buckets.length === 0) lines.push('None.');
    for (const b of buckets) {
        lines.push(`### ${b.key}`);
        lines.push('');
        lines.push(`- Pairs: ${b.seeds.length} (${b.stateChanged} changed the fight state)`);
        lines.push(
            `- Seeds: ${b.seeds.slice(0, 20).join(', ')}${b.seeds.length > 20 ? ', …' : ''}`
        );
        const top = (m: Record<string, number>) =>
            Object.entries(m)
                .sort((x, y) => y[1] - x[1])
                .slice(0, 12)
                .map(([k, v]) => `${k} (${v})`)
                .join(', ');
        lines.push(`- Ships at the divergence: ${top(b.ships)}`);
        if (Object.keys(b.notes).length > 0) lines.push(`- Entry notes: ${top(b.notes)}`);
        const d = b.class === 'log-order' ? b.sample.strict! : b.sample.unordered!;
        const nudged = b.sample.nudges.length
            ? `, speed-nudged ${b.sample.nudges.map((l) => `${l} +${TIE_NUDGE}`).join(', ')}`
            : '';
        lines.push(
            `- Sample (seed ${b.sample.seed}${nudged}, round ${d.round}, ${d.section ?? d.kind}):`
        );
        if (b.nudgedSeeds.length > 0) {
            lines.push(
                `- Speed-nudged seeds (see the JSON \`nudges\` to reproduce): ${b.nudgedSeeds.join(', ')}`
            );
        }
        lines.push(`  - original: \`${d.original}\``);
        lines.push(`  - swapped:  \`${d.swapped}\``);
        const roster = Object.entries(b.sample.ships)
            .map(([label, sh]) => `${label}=${sh.name}@${sh.position}`)
            .join(' ');
        lines.push(`  - roster: ${roster}`);
        if (b.sample.kindDiffs.length > 0) {
            for (const k of b.sample.kindDiffs) {
                lines.push(
                    `  - ${k.label} ${k.shipName}: only original [${k.onlyOriginal.join(', ')}], only swapped [${k.onlySwapped.join(', ')}]`
                );
            }
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

main();
