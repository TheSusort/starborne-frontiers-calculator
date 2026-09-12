import type { SeedRunSummary, SeedSetAggregate } from './seededRuns';

/**
 * Whether a difference between two seed-set aggregates is large enough, relative to its own
 * spread, to be worth reading as a result.
 *
 * The comparison is PAIRED: `effectiveRunParams` forces a variant run onto the pinned baseline's
 * exact seed set, so seed *i* of one aggregate and seed *i* of the other are the same fight under
 * two configurations. Pairing removes the variance the two share — that fight's own luck — which
 * is what makes a difference of a couple of wins at N=20 readable as noise rather than a result.
 */
export interface PairedDelta {
    /** Mean of the per-seed differences `current - baseline`. */
    mean: number;
    /** Standard error of that mean: `sd(differences) / sqrt(n)`. */
    se: number;
    n: number;
    distinguishable: boolean;
}

/** |mean / se| at or above this counts as distinguishable — roughly a 95% two-sided call. Fixed,
 *  not a user setting: a threshold a reader can lower until they like the answer is not a
 *  safeguard. */
export const T_THRESHOLD = 2;

export function pairedDelta(baselineValues: number[], currentValues: number[]): PairedDelta {
    if (baselineValues.length !== currentValues.length) {
        throw new Error(
            `pairedDelta: series length mismatch (${baselineValues.length} vs ${currentValues.length})`
        );
    }
    const n = baselineValues.length;
    if (n === 0) return { mean: 0, se: 0, n, distinguishable: false };

    const differences = currentValues.map((value, i) => value - baselineValues[i]);
    const mean = differences.reduce((a, b) => a + b, 0) / n;

    // A single pair has no spread to measure, however large the difference is.
    if (n < 2) return { mean, se: 0, n, distinguishable: false };

    const variance = differences.reduce((acc, d) => acc + (d - mean) ** 2, 0) / (n - 1);
    const se = Math.sqrt(variance) / Math.sqrt(n);

    // Zero spread means every seed moved by the identical amount: the strongest signal there is
    // when that amount is non-zero, and no change at all when it is zero.
    const distinguishable = se === 0 ? mean !== 0 : Math.abs(mean / se) >= T_THRESHOLD;

    return { mean, se, n, distinguishable };
}

/** Re-express a delta in different units — a win *rate* as a win *count*, say. `t` is
 *  scale-invariant, so the verdict is carried through unchanged rather than recomputed. */
export function scalePairedDelta(delta: PairedDelta, factor: number): PairedDelta {
    return { ...delta, mean: delta.mean * factor, se: delta.se * factor };
}

/**
 * Line two aggregates up seed by seed and pull one value out of each run.
 *
 * Throws when the aggregates did not run the same seed set. There is deliberately no unpaired
 * fallback: an unpaired series would still render a confident-looking spread while silently
 * measuring something else.
 */
export function pairedSeries(
    baseline: SeedSetAggregate,
    current: SeedSetAggregate,
    pick: (run: SeedRunSummary) => number
): { baseline: number[]; current: number[] } {
    const baselineRuns = baseline.runs;
    const currentRuns = current.runs;
    if (
        baselineRuns.length !== currentRuns.length ||
        baselineRuns.some((run, i) => run.seed !== currentRuns[i].seed)
    ) {
        throw new Error(
            'pairedSeries: the two aggregates do not share a seed set, so a paired comparison is not valid'
        );
    }
    return {
        baseline: baselineRuns.map(pick),
        current: currentRuns.map(pick),
    };
}
