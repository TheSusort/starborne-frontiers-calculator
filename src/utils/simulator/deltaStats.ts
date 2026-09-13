import type { SeedRunSummary, SeedSetAggregate } from './seededRuns';

/**
 * Whether a difference between two seed-set aggregates is large enough, relative to its own
 * spread, to be worth reading as a result.
 *
 * The comparison is PAIRED: `effectiveRunParams` forces a variant run onto the pinned baseline's
 * exact seed set, so seed *i* of one aggregate and seed *i* of the other are the same fight under
 * two configurations. Pairing removes the variance the two share — that fight's own luck — which
 * is what makes a difference of a couple of wins at N=20 readable as noise rather than a result.
 *
 * Two tests decide `distinguishable`, chosen by the caller's `metricKind` — by what the metric
 * IS, never inferred from how a particular pair of runs happened to land. A *rounds* delta where
 * every seed moves by at most one round still takes the continuous rule: it is a continuous
 * metric that drew a narrow sample, not a win/draw indicator.
 *
 * - `'continuous'` (the default — rounds, damage, healing, and every other non-binary metric)
 *   takes the paired t rule: `|mean / se| >= studentTCritical95(n - 1)`. The critical value is
 *   read off the two-sided 95% t table for the sample's own degrees of freedom, not a fixed
 *   constant — at small `n` the normal approximation (`1.960`) understates it enormously (12.706
 *   at `n = 2`), which would report a difference as distinguishable when the sample is far too
 *   small to support that call.
 * - `'binary'` (a win/draw row: the per-seed value is a 0/1 indicator) takes the exact two-sided
 *   sign test on the non-zero differences instead. A win/draw indicator puts most of its mass at
 *   zero, which the normal approximation behind the t rule badly misfits: an all-same-direction
 *   flip on as few as 4 of 20 seeds clears the t threshold despite an exact binomial test rating
 *   it a coin flip, and raising the seed count does not fix this — the t-statistic for a fixed
 *   flip count is nearly seed-count invariant. `mean` and `se` are still the ordinary paired
 *   mean/standard-error of the differences either way; only the verdict changes.
 */
export interface PairedDelta {
    /** Mean of the per-seed differences `current - baseline`. */
    mean: number;
    /** Standard error of that mean: `sd(differences) / sqrt(n)`. */
    se: number;
    n: number;
    distinguishable: boolean;
}

/** The two-sided 95% t critical value as degrees of freedom go to infinity — the normal
 *  approximation `studentTCritical95` falls back to past `df = 100`. NOT the threshold the
 *  continuous path compares against: at finite `n` that is `studentTCritical95(n - 1)`, which is
 *  always at least this large. */
export const T_CRITICAL_95_ASYMPTOTE = 1.96;

/** The binary (sign-test) path's significance level — its `p <= SIGN_TEST_ALPHA` plays the same
 *  role `studentTCritical95(df)` plays on the continuous path. Fixed, not a user setting: a
 *  threshold a reader can lower until they like the answer is not a safeguard. */
export const SIGN_TEST_ALPHA = 0.05;

/** Two-sided 95% t critical values by degrees of freedom, `df` ascending. Hand-transcribed from a
 *  standard t table rather than computed, because inverting the t distribution numerically is
 *  much harder to audit than reading a table. */
const T_CRITICAL_95_TABLE: ReadonlyArray<readonly [df: number, critical: number]> = [
    [1, 12.706],
    [2, 4.303],
    [3, 3.182],
    [4, 2.776],
    [5, 2.571],
    [6, 2.447],
    [7, 2.365],
    [8, 2.306],
    [9, 2.262],
    [10, 2.228],
    [11, 2.201],
    [12, 2.179],
    [13, 2.16],
    [14, 2.145],
    [15, 2.131],
    [16, 2.12],
    [17, 2.11],
    [18, 2.101],
    [19, 2.093],
    [20, 2.086],
    [21, 2.08],
    [22, 2.074],
    [23, 2.069],
    [24, 2.064],
    [25, 2.06],
    [26, 2.056],
    [27, 2.052],
    [28, 2.048],
    [29, 2.045],
    [30, 2.042],
    [40, 2.021],
    [60, 2.0],
    [80, 1.99],
    [100, 1.984],
];

/** The two-sided 95% critical value for `df` degrees of freedom, read off `T_CRITICAL_95_TABLE`.
 *  A `df` that falls between two table entries takes the next LOWER entry's value — the larger,
 *  more conservative critical value — rather than interpolating: `df = 35` reads the `df = 30`
 *  row's `2.042`. Above `df = 100` this returns `T_CRITICAL_95_ASYMPTOTE`.
 *  Undefined for `df < 1`; `pairedDelta` never calls this below `n = 2` (`df = 1`). */
export function studentTCritical95(df: number): number {
    if (df > 100) return T_CRITICAL_95_ASYMPTOTE;
    let critical = T_CRITICAL_95_TABLE[0][1];
    for (const [tableDf, tableCritical] of T_CRITICAL_95_TABLE) {
        if (tableDf > df) break;
        critical = tableCritical;
    }
    return critical;
}

/** Which statistical test `pairedDelta` runs, chosen by what the metric IS: `'binary'` for a
 *  win/draw indicator row, `'continuous'` for everything else (rounds, damage, healing, ...). */
export type PairedMetricKind = 'binary' | 'continuous';

/** `P(X >= k)` for `X ~ Binomial(m, 0.5)`, via the running ratio between adjacent binomial
 *  probabilities rather than raw coefficients — `m` can run up to `MAX_RUN_COUNT`
 *  (`src/utils/simulator/seedRunInputs.ts`), where a coefficient itself would be astronomically
 *  large before the halving. `deltaStats.test.ts` binds this arithmetic to that ceiling. */
export function binomialTailProbability(m: number, k: number): number {
    let term = 0.5 ** m; // P(X = 0)
    let tail = 0;
    for (let i = 0; i <= m; i++) {
        if (i >= k) tail += term;
        term = (term * (m - i)) / (i + 1);
    }
    return tail;
}

/** Exact two-sided sign test (McNemar's test for paired binary outcomes) on a series of
 *  `{-1, 0, 1}` differences: ties (zeros) are discarded, then the non-zero split is asked how
 *  surprising it is under a fair coin. Two-sided p is `2 * P(X >= k)` for `X ~ Binomial(m, 0.5)`,
 *  `m` the non-zero count and `k` the majority-direction count, clamped at 1 (the two tails can
 *  overlap when the split is near even). */
function signTestDistinguishable(differences: number[]): boolean {
    const nonZero = differences.filter((d) => d !== 0);
    const m = nonZero.length;
    if (m === 0) return false;
    const positive = nonZero.filter((d) => d > 0).length;
    const majority = Math.max(positive, m - positive);
    const p = Math.min(1, 2 * binomialTailProbability(m, majority));
    return p <= SIGN_TEST_ALPHA;
}

export function pairedDelta(
    baselineValues: number[],
    currentValues: number[],
    metricKind: PairedMetricKind = 'continuous'
): PairedDelta {
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

    let distinguishable: boolean;
    if (metricKind === 'binary') {
        distinguishable = signTestDistinguishable(differences);
    } else {
        // Zero spread means every seed moved by the identical amount: the strongest signal there
        // is when that amount is non-zero, and no change at all when it is zero.
        distinguishable = se === 0 ? mean !== 0 : Math.abs(mean / se) >= studentTCritical95(n - 1);
    }

    return { mean, se, n, distinguishable };
}

/** Re-express a delta in different units — a win *rate* as a win *count*, say. Both the t rule and
 *  the sign test read only the sign/ratio of the differences, never their absolute scale, so
 *  either verdict is carried through unchanged rather than recomputed. */
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
