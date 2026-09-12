import { describe, it, expect } from 'vitest';
import { pairedDelta, pairedSeries, scalePairedDelta } from '../deltaStats';
import type { SeedRunSummary, SeedSetAggregate } from '../seededRuns';

/** A per-seed win indicator series with `wins` ones followed by zeros — the shape the win-count
 *  rows feed in. Order does not matter to a paired statistic beyond how it lines up against the
 *  other series, and both series here are built the same way. */
const winSeries = (wins: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => (i < wins ? 1 : 0));

const run = (seed: number, lastRound: number): SeedRunSummary => ({
    seed,
    winner: 'draw',
    lastRound,
    perActor: {},
});

const aggregateWithRuns = (runs: SeedRunSummary[]): SeedSetAggregate => ({
    baseSeed: runs[0]?.seed ?? 0,
    count: runs.length,
    roster: [],
    runs,
    wins: { player: 0, enemy: 0, draw: runs.length },
    meanRounds: 0,
    medianRounds: 0,
    perActorMean: {},
});

describe('pairedDelta', () => {
    it('calls a two-win difference over twenty seeds indistinguishable', () => {
        // #508's own noise example: 10/20 against 12/20.
        const result = pairedDelta(winSeries(10, 20), winSeries(12, 20));
        expect(result.n).toBe(20);
        // Pinned against an independently computed value, not the implementation's own formula:
        // this is the one assertion in the file that separates the sample standard deviation
        // (Bessel-corrected, /(n - 1)) from the population one (/n) — the two denominators land
        // on the same side of the distinguishability threshold for every other case here, so this
        // is what stops the denominator from drifting silently.
        expect(result.se).toBeCloseTo(0.0688247, 6);
        expect(result.distinguishable).toBe(false);
    });

    it('calls a fifteen-win difference over twenty seeds a result', () => {
        // #508's own signal example: 4/20 against 19/20. Paired against the noise case
        // above, this is what makes the instrument non-vacuous: it can report both verdicts.
        const result = pairedDelta(winSeries(4, 20), winSeries(19, 20));
        expect(result.distinguishable).toBe(true);
        expect(result.mean).toBeCloseTo(0.75, 6);
    });

    it('reports the mean of the per-seed differences', () => {
        const result = pairedDelta([10, 10, 10, 10], [12, 14, 8, 10]);
        expect(result.mean).toBeCloseTo(1, 6);
    });

    it('is never distinguishable from a single pair', () => {
        // One difference has no spread to measure, however large it is.
        const result = pairedDelta([0], [1000]);
        expect(result.n).toBe(1);
        expect(result.se).toBe(0);
        expect(result.distinguishable).toBe(false);
    });

    it('calls a non-zero difference with no spread distinguishable', () => {
        // Every seed moved by the same amount: the strongest possible signal, not a
        // divide-by-zero.
        const result = pairedDelta([5, 5, 5, 5], [7, 7, 7, 7]);
        expect(result.se).toBe(0);
        expect(result.mean).toBe(2);
        expect(result.distinguishable).toBe(true);
    });

    it('calls no difference at all indistinguishable', () => {
        const result = pairedDelta([5, 6, 7], [5, 6, 7]);
        expect(result.mean).toBe(0);
        expect(result.se).toBe(0);
        expect(result.distinguishable).toBe(false);
    });

    it('is never distinguishable from an empty series', () => {
        const result = pairedDelta([], []);
        expect(result.n).toBe(0);
        expect(result.distinguishable).toBe(false);
    });

    it('throws when the two series have different lengths', () => {
        expect(() => pairedDelta([1, 2], [1, 2, 3])).toThrow(/length/i);
    });

    describe('the exact sign test on indicator (win/draw) series', () => {
        it('calls five same-direction discordant pairs out of twenty a coin flip, not a result', () => {
            // Five 0->1 flips, the rest unchanged: the exact two-sided sign test on 5 non-zero,
            // all-same-direction differences is p = 2 * 0.5^5 = 0.0625, above the 0.05 cutoff —
            // the boundary the t rule gets wrong (it would call this distinguishable at t=2.52).
            const result = pairedDelta(winSeries(10, 20), winSeries(15, 20));
            expect(result.distinguishable).toBe(false);
        });

        it('calls six same-direction discordant pairs out of twenty a result', () => {
            // One more flip than above: p = 2 * 0.5^6 = 0.03125, at or under the cutoff.
            const result = pairedDelta(winSeries(10, 20), winSeries(16, 20));
            expect(result.distinguishable).toBe(true);
        });

        it('keeps a continuous series on the t rule even where a same-direction majority count would call it differently', () => {
            // 15 of 20 differences are +1 and 5 are -3: the -3 puts this series outside the
            // {-1, 0, 1} indicator range, so it takes the t rule, not the sign test. The mean
            // cancels to exactly zero (15*1 - 5*3 = 0), so the t rule correctly reports no
            // distinguishable difference. Naively counting only each difference's sign would see
            // a 15-vs-5 non-zero split, which the sign test would call distinguishable
            // (p = 2 * P(X >= 15 | Binomial(20, 0.5)) ≈ 0.041) — the two rules disagree here,
            // which is exactly why the series shape must gate which one runs.
            const baselineValues = new Array<number>(20).fill(0);
            const currentValues = [
                ...new Array<number>(15).fill(1),
                ...new Array<number>(5).fill(-3),
            ];
            const result = pairedDelta(baselineValues, currentValues);
            expect(result.mean).toBe(0);
            expect(result.distinguishable).toBe(false);
        });
    });
});

describe('scalePairedDelta', () => {
    it('scales the mean and spread but not the verdict', () => {
        // t is scale-invariant, so rendering a win rate as a win count cannot change whether
        // the difference is distinguishable.
        const rate = pairedDelta(winSeries(4, 20), winSeries(19, 20));
        const counts = scalePairedDelta(rate, 20);
        expect(counts.mean).toBeCloseTo(rate.mean * 20, 6);
        expect(counts.se).toBeCloseTo(rate.se * 20, 6);
        expect(counts.distinguishable).toBe(rate.distinguishable);
        expect(counts.n).toBe(rate.n);
    });
});

describe('pairedSeries', () => {
    it('extracts both series in seed order', () => {
        const baseline = aggregateWithRuns([run(1, 5), run(2, 6), run(3, 7)]);
        const current = aggregateWithRuns([run(1, 4), run(2, 6), run(3, 9)]);
        expect(pairedSeries(baseline, current, (r) => r.lastRound)).toEqual({
            baseline: [5, 6, 7],
            current: [4, 6, 9],
        });
    });

    it('throws when the two aggregates ran different seeds', () => {
        // A silent unpaired fallback would still render a confident-looking spread, which is
        // the exact failure this module exists to prevent.
        const baseline = aggregateWithRuns([run(1, 5), run(2, 6)]);
        const current = aggregateWithRuns([run(1, 5), run(99, 6)]);
        expect(() => pairedSeries(baseline, current, (r) => r.lastRound)).toThrow(/seed set/i);
    });

    it('throws when the two aggregates ran different numbers of seeds', () => {
        const baseline = aggregateWithRuns([run(1, 5), run(2, 6)]);
        const current = aggregateWithRuns([run(1, 5)]);
        expect(() => pairedSeries(baseline, current, (r) => r.lastRound)).toThrow(/seed set/i);
    });
});
