import { describe, it, expect } from 'vitest';
import { effectiveRunParams } from '../effectiveRunParams';
import type { PinnedBaseline } from '../compareRuns';
import type { SeedSetAggregate } from '../seededRuns';

const aggregate = (baseSeed: number, count: number): SeedSetAggregate => ({
    baseSeed,
    count,
    roster: [],
    runs: [],
    wins: { player: 0, enemy: 0, draw: 0 },
    meanRounds: 0,
    medianRounds: 0,
    perActorMean: {},
});

const baseline = (baseSeed: number, count: number): PinnedBaseline => ({
    aggregate: aggregate(baseSeed, count),
    overrides: {},
});

describe('effectiveRunParams', () => {
    it('returns the page inputs when no baseline is pinned', () => {
        expect(effectiveRunParams(null, 42, 5)).toEqual({ seed: 42, runCount: 5 });
    });

    it("returns the baseline's seed and count while pinned, ignoring the page inputs", () => {
        // The page's own seed/runCount (42, 5) differ from the pinned baseline's (777, 30).
        // This is the load-bearing pairing guarantee: a variant run must reuse the baseline's
        // exact seed set or the comparison is unpaired while still presenting itself as paired.
        expect(effectiveRunParams(baseline(777, 30), 42, 5)).toEqual({
            seed: 777,
            runCount: 30,
        });
    });
});
