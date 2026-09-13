import {
    simulateBattle,
    type BattleResult,
    type BattleSimulationInput,
} from '../calculators/battleSimulator';
import { resetRateGateRng, setupKeyedRng } from '../calculators/rateAccumulator';
import type { GearPiece } from '../../types/gear';

/**
 * Run a battle under a pinned RNG seed so the result is byte-reproducible.
 *
 * Production combat draws crit, hit, debuff landing and every proc from `Math.random` via
 * `rateAccumulator`. This installs a seeded keyed sub-stream provider for the duration of the
 * call and restores `Math.random` in `finally`, so a throwing battle never leaks the seeded
 * stream into a later run.
 *
 * The `finally` restores the production default, NOT any ambient test seed — so a raw
 * `simulateBattle` called straight after this one is nondeterministic. Go through this
 * function, or re-seed yourself.
 */
export function runSeededBattle(
    input: BattleSimulationInput,
    seed: number,
    getGearPiece?: (id: string) => GearPiece | undefined
): BattleResult {
    setupKeyedRng(seed);
    try {
        return simulateBattle(input, getGearPiece);
    } finally {
        resetRateGateRng();
    }
}

export interface ActorTotals {
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
}

export interface SeedRunSummary {
    seed: number;
    winner: 'player' | 'enemy' | 'draw';
    lastRound: number;
    /** Keyed by engine actorId (`p:<shipId>:<i>` / `e:<shipId>:<i>`, player index 0 is FOCUS_ID). */
    perActor: Record<string, ActorTotals>;
}

export interface SeedSetAggregate {
    baseSeed: number;
    count: number;
    /** Roster of the first run. Constant across seeds for one input, so the aggregate carries it
     *  and consumers never need to name actors by raw actorId. */
    roster: BattleResult['roster'];
    runs: SeedRunSummary[];
    wins: { player: number; enemy: number; draw: number };
    meanRounds: number;
    medianRounds: number;
    perActorMean: Record<string, ActorTotals>;
}

/** Collapse one battle into its comparable scalars.
 *  `ShipRoundState.damageDealt` / `damageTaken` / `healingDone` are PER-ROUND rates, not running
 *  cumulatives, so a fight total is a sum across `result.rounds`. */
export function summarizeRun(result: BattleResult, seed: number): SeedRunSummary {
    const perActor: Record<string, ActorTotals> = {};
    for (const round of result.rounds) {
        for (const ship of round.ships) {
            const totals = (perActor[ship.actorId] ??= {
                damageDealt: 0,
                damageTaken: 0,
                healingDone: 0,
            });
            totals.damageDealt += ship.damageDealt;
            totals.damageTaken += ship.damageTaken;
            totals.healingDone += ship.healingDone;
        }
    }
    return {
        seed,
        winner: result.outcome.winner,
        lastRound: result.outcome.lastRound,
        perActor,
    };
}

/** Median of an ascending-sorted, non-empty series. An even-sized series averages the two middle
 *  values, so a 20-seed set reports the midpoint between its 10th and 11th shortest fights rather
 *  than the longer of the pair. */
export function median(sorted: number[]): number {
    const mid = sorted.length / 2;
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
}

/** A seed set is at least one battle. `Number('')` from a cleared input field is `0`, which is
 *  the value this exists to reject. */
function assertRunCount(count: number): void {
    if (!Number.isInteger(count) || count < 1) {
        throw new Error(`seed set count must be a positive integer, got ${count}`);
    }
}

/** Collapse a completed set of per-seed summaries into the aggregate both run entry points
 *  return. Shared by the synchronous and async paths so the two cannot drift: an aggregate is
 *  a function of its runs, and nothing about how those runs were scheduled reaches it. */
export function aggregateRuns(
    runs: SeedRunSummary[],
    roster: BattleResult['roster'],
    baseSeed: number,
    count: number
): SeedSetAggregate {
    const wins = { player: 0, enemy: 0, draw: 0 };
    for (const run of runs) wins[run.winner]++;

    const rounds = runs.map((r) => r.lastRound);
    const sorted = [...rounds].sort((a, b) => a - b);

    const perActorMean: Record<string, ActorTotals> = {};
    for (const run of runs) {
        for (const [actorId, totals] of Object.entries(run.perActor)) {
            const acc = (perActorMean[actorId] ??= {
                damageDealt: 0,
                damageTaken: 0,
                healingDone: 0,
            });
            acc.damageDealt += totals.damageDealt;
            acc.damageTaken += totals.damageTaken;
            acc.healingDone += totals.healingDone;
        }
    }
    for (const totals of Object.values(perActorMean)) {
        totals.damageDealt /= runs.length;
        totals.damageTaken /= runs.length;
        totals.healingDone /= runs.length;
    }

    return {
        baseSeed,
        count,
        roster,
        runs,
        wins,
        meanRounds: rounds.reduce((a, b) => a + b, 0) / rounds.length,
        medianRounds: median(sorted),
        perActorMean,
    };
}

/**
 * Run the same input over seeds `baseSeed .. baseSeed + count - 1` and aggregate.
 *
 * One seeded run REPRODUCES a fight; only an aggregate over a seed set COMPARES two
 * configurations. Seeding is not full pairing: a stat change alters kill timing, which alters how
 * many draws each actor takes, so keyed sub-streams desync downstream of the first divergence
 * even under one seed.
 *
 * Synchronous: the whole seed set runs on the calling task. `runSeedSetAsync` is the same loop
 * with a yield between seeds, for a run that needs progress or cancellation.
 */
export function runSeedSet(
    input: BattleSimulationInput,
    baseSeed: number,
    count: number,
    getGearPiece?: (id: string) => GearPiece | undefined
): SeedSetAggregate {
    assertRunCount(count);

    const runs: SeedRunSummary[] = [];
    let roster: BattleResult['roster'] = [];
    for (let i = 0; i < count; i++) {
        const seed = baseSeed + i;
        const result = runSeededBattle(input, seed, getGearPiece);
        if (i === 0) roster = result.roster;
        runs.push(summarizeRun(result, seed));
    }

    return aggregateRuns(runs, roster, baseSeed, count);
}

export interface SeedSetRunOptions {
    getGearPiece?: (id: string) => GearPiece | undefined;
    /** Aborting stops the loop between seeds and resolves `null`. */
    signal?: AbortSignal;
    /** Called at most ~100 times over the whole run, always including the final seed, with
     *  `(completed, total)`. At or below 100 seeds it fires once per completed seed; a run
     *  cancelled before its last seed lands never receives the final call — see
     *  `runSeedSetAsync`'s doc. */
    onProgress?: (completed: number, total: number) => void;
}

/**
 * `runSeedSet`, yielding to the event loop between every seed (including the first) so a long
 * run neither freezes the page nor has to finish before the UI can paint.
 *
 * Yielding is safe because each seed's RNG setup and teardown are contained inside
 * `runSeededBattle`: there is no cross-seed state for another task to corrupt, and nothing else
 * on the page can observe a half-seeded RNG.
 *
 * Resolves `null` when the signal aborts — **never a partial aggregate**. A cancelled run
 * produced no result, and a caller must not be able to display one. Because a `onProgress` call
 * for the final seed sits behind an abort check, a run cancelled during its last yield reports no
 * further progress rather than painting 100% just before the result is discarded.
 */
export async function runSeedSetAsync(
    input: BattleSimulationInput,
    baseSeed: number,
    count: number,
    options: SeedSetRunOptions = {}
): Promise<SeedSetAggregate | null> {
    assertRunCount(count);
    const { getGearPiece, signal, onProgress } = options;

    // Each `onProgress` call re-renders every consumer of the result it reports (see
    // `SeedSetResults`), so a 1,000-seed run cannot fire one per seed without flooding the
    // results tree. Reporting at most ~100 times keeps that cost constant regardless of `count`,
    // while a count at or below 100 keeps reporting every seed unchanged.
    const reportEvery = Math.max(1, Math.ceil(count / 100));

    const runs: SeedRunSummary[] = [];
    let roster: BattleResult['roster'] = [];
    for (let i = 0; i < count; i++) {
        if (signal?.aborted) return null;
        await new Promise((resolve) => setTimeout(resolve));
        const seed = baseSeed + i;
        const result = runSeededBattle(input, seed, getGearPiece);
        if (i === 0) roster = result.roster;
        runs.push(summarizeRun(result, seed));

        const completed = i + 1;
        if (!signal?.aborted && (completed % reportEvery === 0 || completed === count)) {
            onProgress?.(completed, count);
        }
    }
    if (signal?.aborted) return null;

    return aggregateRuns(runs, roster, baseSeed, count);
}
