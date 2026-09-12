import type { PinnedBaseline } from './compareRuns';

export interface EffectiveRunParams {
    seed: number;
    runCount: number;
}

/**
 * The seed and run count a run actually uses. With no baseline pinned, that is the page's own
 * `seed`/`runCount`. While a baseline is pinned, a variant run must reuse the baseline's exact
 * seed set or the comparison it produces is unpaired while still presenting itself as paired —
 * so this ignores the page's `seed`/`runCount` entirely and returns `baseline.aggregate`'s
 * `baseSeed`/`count` instead.
 */
export function effectiveRunParams(
    baseline: PinnedBaseline | null,
    seed: number,
    runCount: number
): EffectiveRunParams {
    if (baseline) {
        return { seed: baseline.aggregate.baseSeed, runCount: baseline.aggregate.count };
    }
    return { seed, runCount };
}
