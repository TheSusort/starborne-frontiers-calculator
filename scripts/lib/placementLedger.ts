import { PLACEMENTS, type Placement, type PlacementDiff } from '../../src/utils/combat/audit/types';

/** Raised 5 -> 30 (2026-08-21). K=5 is a false-positive generator: it produced 12 findings where
 *  K=15 produced 2, and the Enforcer `debuff-resisted` triage measured the `focus` path needing 24
 *  seeds before it was observed AT ALL — so a small union reads a landing-RNG artifact as a
 *  one-sided path gap. K=30 (~6 min at ~11.8s/seed, from 67s) is the floor that clears that
 *  artifact. See enforcerDebuffResistedNoise.test.ts. */
const DEFAULT_SEEDS = 30;

function parsePositiveIntArg(flag: string, raw: string | undefined): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    return n;
}

function parseIntArg(flag: string, raw: string | undefined): number {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
        throw new Error(`${flag} must be an integer, got ${JSON.stringify(raw)}`);
    }
    return n;
}

/** Pure: parses `--seeds <K>` / `--base-seed <N>`. `--seeds` is the number of consecutive seeds to
 *  union over, not a seed value, and must be a positive integer. `--base-seed` is a seed value
 *  itself (any integer, including negative and zero). Unrecognized tokens are ignored (no
 *  positional args). Throws with the offending raw token on an invalid value. */
export function parsePlacementArgs(argv: string[]): { seeds: number; baseSeed: number } {
    const out = { seeds: DEFAULT_SEEDS, baseSeed: Number.NaN };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--seeds') out.seeds = parsePositiveIntArg('--seeds', argv[++i]);
        else if (argv[i] === '--base-seed') out.baseSeed = parseIntArg('--base-seed', argv[++i]);
    }
    return out;
}

/** Numbers that make a zero-finding sweep auditable instead of merely reassuring. */
export interface PlacementHealth {
    shipsSwept: number;
    seeds: number[];
    /** Ships that produced NO kinds at all, per placement. Must be 0 — a nonzero count means the
     *  sweep observed nothing and every "missing" finding is an artifact. */
    emptyByPlacement: Record<Placement, number>;
    /** Distinct kinds observed across the corpus, per placement. */
    kindsByPlacement: Record<Placement, number>;
    /** Ships whose three placements agreed exactly. */
    symmetricShips: number;
}

/** A `(ship, kind)` pair that has already been triaged to a verdict of "seed noise, not a path
 *  gap", so a future sweep that surfaces it again does not cost another triage. Matching is by
 *  ship + kind and deliberately NOT by direction: a proc-gated kind that a given draw never
 *  produced also never produces the reverse diff, so direction agreement is a consequence of the
 *  noise, never independent evidence for or against it. */
export interface TriagedNoiseEntry {
    shipName: string;
    kind: string;
    note: string;
}

/** VERDICTS — each entry is backed by a committed test that fails if the verdict stops holding.
 *  Add to this list only after measuring the kind's per-placement hit RATE over a seed window
 *  several times wider than the sweep's K; a single wider re-run that happens to come back clean
 *  is not a verdict. */
export const TRIAGED_AS_SEED_NOISE: readonly TriagedNoiseEntry[] = [
    {
        shipName: 'Enforcer',
        kind: 'debuff-resisted',
        note:
            'doubly RNG-gated (Defense Shred arms only on a crit, then has to FAIL a landing roll ' +
            'against filler security 0–24 vs hacking 96). The three boards are an exact mirror — ' +
            'the same four enemy fillers in every placement — so only the ownerId-keyed RNG ' +
            'sub-stream differs. Measured over 40 seeds from base 20260805 (plain scenario): ' +
            'focus 4 hits, team 2, enemy 5; first hit at offset +23 / +16 / +4 respectively, which ' +
            'is exactly why a K=15 union catches enemy and misses the other two. Pinned by ' +
            'src/utils/combat/audit/__tests__/enforcerDebuffResistedNoise.test.ts.',
    },
    {
        shipName: 'Apex',
        kind: 'shield-destroyed',
        note:
            'Apex self-grants a 355 Shield (3% max HP) on every enemy debuff and inflicts two ' +
            'debuffs per cast, so the pool GROWS faster than the board drains it. ' +
            '`shield-destroyed` needs a direct hit to take a non-empty pool to exactly 0, which ' +
            'here requires a round where Apex lands NO debuff — a landing roll, drawn off the ' +
            'ownerId-keyed stream. Measured over 180 seeds from base 20260805, all three ' +
            'scenarios (hits/540): focus 3, team 12, enemy 21; every hit reproduced in all three ' +
            'scenarios, so the scenario tap does not move this draw. `plain`-only first hit at ' +
            'offset +45 / +94 / +20 respectively — focus lands ONE seed past the K=45 window the ' +
            'finding was filed at, which is the whole finding. The firing trajectories match ' +
            'shape across sides (grant r1, no grant r2, destroy r3, on mirrored turn orders). ' +
            'Pinned by src/utils/combat/audit/__tests__/apexShieldDestroyedNoise.test.ts.',
    },
];

function triagedNoiseFor(d: PlacementDiff, kind: string): TriagedNoiseEntry | undefined {
    return TRIAGED_AS_SEED_NOISE.find(
        (t) => t.shipName.toUpperCase() === d.shipName.toUpperCase() && t.kind === kind
    );
}

export function buildPlacementLedgerJson(diffs: PlacementDiff[], health: PlacementHealth) {
    return { health, findingCount: diffs.length, findings: diffs };
}

function hasVacuity(health: PlacementHealth): boolean {
    return Object.values(health.emptyByPlacement).some((n) => n > 0);
}

export function renderPlacementLedgerMarkdown(
    diffs: PlacementDiff[],
    health: PlacementHealth
): string {
    const lines: string[] = [
        '# Placement Symmetry Ledger',
        '',
        'Each corpus ship run by all three engine actor paths (`attacker` / `team` / `enemy`) on',
        'byte-identical cells. A finding is a log-entry kind produced in one placement and never in',
        'another. **Findings are CANDIDATES** — confirm with direct engine instrumentation before',
        'recording any of them as a real bug.',
        '',
        `- Ships swept: **${health.shipsSwept}**`,
        `- Seeds unioned: **${health.seeds.length}** (${health.seeds.join(', ')})`,
        `- Ships symmetric across all three placements: **${health.symmetricShips}**`,
        `- Findings: **${diffs.length}**`,
        '',
        '## Suite health',
        '',
        '| placement | distinct kinds | ships observing nothing |',
        '| --- | --- | --- |',
    ];
    for (const placement of PLACEMENTS) {
        lines.push(
            `| ${placement} | ${health.kindsByPlacement[placement]} | ${health.emptyByPlacement[placement]} |`
        );
    }
    lines.push('');
    if (hasVacuity(health)) {
        lines.push(
            '> **VACUITY WARNING:** at least one placement observed nothing for some ships. Every',
            '> "missing" finding below is suspect until that is explained — an unresolved subject id',
            '> fingerprints an empty set and looks exactly like a total behaviour loss.',
            ''
        );
    }
    lines.push(
        '**Calibration is narrower than it sounds.** The calibration subjects (`CALIBRATION_SUBJECT_NAMES`)',
        'have no passives, no charge skill, and only a bare damage-dealing active, so their fingerprint is',
        'structurally bounded to `{}` or `{attack}` — no other `CombatLogEntryKind` value can EVER appear',
        'for them, in any placement, at any seed count. A clean calibration therefore proves the',
        "subject's actor id resolves correctly in all three placements for the `attack` pathway. It does NOT",
        'rule out an asymmetry in heal, shield, buff, death, or charge-changed attribution — those pathways',
        'are simply **not exercised** by the calibration gate at all.',
        ''
    );
    lines.push(
        '**Seed noise, not just calibration scope, is a confound.** The RNG sub-stream is keyed by actor',
        'id, which necessarily changes with placement. Measured on this branch: the same crit landed at',
        'rounds 6+13 as `focus`, 5+16 as `team`, 7+20 as `enemy` — same physical ship, same seed, three',
        `different draws. Union-over-K-seeds is the mitigation, but at K=${health.seeds.length} on this run its`,
        'strength is unquantified, and a landing- or proc-gated kind can still differ between placements',
        'purely by draw. A kind that appears in one placement and not another, for only a handful of',
        'ships, and with no consistent direction across those ships, is the signature of seed noise, not',
        'a path gap. Before instrumenting a low-ship-count finding, re-run with a different `--base-seed`',
        'and see if it survives.',
        '',
        "**`playerTeam[0]` is also the engine's heal target in positional mode**",
        '(`src/utils/combat/engine.ts:2282`: `healTarget = explicitHealTarget ?? (input.positionalTeamBattle',
        '? attacker : undefined)`). So the subject is the heal target ONLY in the `focus` placement — a',
        'real engine-role difference the transform cannot remove, not a harness bug. Read any `heal`',
        'finding below with that in mind.',
        ''
    );
    lines.push('## Findings', '');
    if (diffs.length === 0) {
        lines.push('No placement asymmetries observed.', '');
    } else {
        for (const d of diffs) {
            lines.push(
                `- **${d.shipName}** — fires as \`${d.from}\` but never as \`${d.to}\`: ` +
                    `${d.missing.map((k) => `\`${k}\``).join(', ')}`
            );
            for (const kind of d.missing) {
                const triaged = triagedNoiseFor(d, kind);
                if (triaged) {
                    lines.push(
                        `  - \`${kind}\` — **TRIAGED, seed noise, do not re-triage.** ${triaged.note}`
                    );
                }
            }
        }
        lines.push('');
    }
    return lines.join('\n');
}
