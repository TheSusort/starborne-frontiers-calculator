import { describe, it, expect } from 'vitest';
import {
    pairedDelta,
    pairedSeries,
    scalePairedDelta,
    binomialTailProbability,
    studentTCritical95,
} from '../deltaStats';
import { MAX_RUN_COUNT } from '../seedRunInputs';
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

    describe('the exact sign test on a binary (win/draw) series', () => {
        it('calls five same-direction discordant pairs out of twenty a coin flip, not a result', () => {
            // Five 0->1 flips, the rest unchanged: the exact two-sided sign test on 5 non-zero,
            // all-same-direction differences is p = 2 * 0.5^5 = 0.0625, above the 0.05 cutoff —
            // the boundary the t rule gets wrong (it would call this distinguishable at t=2.52).
            const result = pairedDelta(winSeries(10, 20), winSeries(15, 20), 'binary');
            expect(result.distinguishable).toBe(false);
        });

        it('calls six same-direction discordant pairs out of twenty a result', () => {
            // One more flip than above: p = 2 * 0.5^6 = 0.03125, at or under the cutoff.
            const result = pairedDelta(winSeries(10, 20), winSeries(16, 20), 'binary');
            expect(result.distinguishable).toBe(true);
        });

        it('reads a continuous series on the t rule even where a same-direction majority count would call it differently', () => {
            // 15 of 20 differences are +1 and 5 are -3: not called with the binary option, so
            // this stays on the t rule regardless of shape. The mean cancels to exactly zero
            // (15*1 - 5*3 = 0), so the t rule correctly reports no distinguishable difference.
            // Naively counting only each difference's sign would see a 15-vs-5 non-zero split,
            // which the sign test would call distinguishable
            // (p = 2 * P(X >= 15 | Binomial(20, 0.5)) ≈ 0.041) — the two rules disagree here,
            // which is exactly why the caller, not the values, must choose which one runs.
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

    describe('routing is chosen by the caller, not sniffed from the values', () => {
        it('gives the continuous verdict for a same-direction {-1,0,1}-shaped series when no metric kind is passed', () => {
            // Every seed moves by exactly one: the shape a win/draw row also produces, but this
            // is called the way a rounds delta is (no third argument), so it stays on the t rule.
            // Zero spread means the `se === 0` shortcut fires: distinguishable whenever mean !== 0.
            const result = pairedDelta([0, 0, 0, 0], [1, 1, 1, 1]);
            expect(result.distinguishable).toBe(true);
        });

        it('gives the sign-test verdict for the identical series when called with the binary option, and finds it not distinguishable at n=4', () => {
            // Same series as above, now told it is a binary metric: an exact sign test on 4
            // non-zero, all-same-direction differences is p = 2 * 0.5^4 = 0.125, above the 0.05
            // cutoff — the sign test cannot reach p <= 0.05 below 6 non-zero differences.
            const result = pairedDelta([0, 0, 0, 0], [1, 1, 1, 1], 'binary');
            expect(result.distinguishable).toBe(false);
        });
    });
});

describe('the continuous path scales its threshold to the sample size', () => {
    it('calls differences of [1, 2] at n=2 not distinguishable, where the fixed-threshold-of-2 rule got it wrong', () => {
        // t = |mean| / se = 3.0 here — over the old fixed threshold of 2, but the true two-sided
        // 95% critical value at df=1 (n=2) is 12.706: a sample this small cannot support a call
        // this confident, however large the difference looks.
        const result = pairedDelta([0, 0], [1, 2]);
        expect(result.n).toBe(2);
        expect(Math.abs(result.mean / result.se)).toBeCloseTo(3, 6);
        expect(result.distinguishable).toBe(false);
    });

    it('can still call a difference distinguishable at n=2, so the small-n path is not just a permanent refusal', () => {
        // Same n as the case above, same paired-difference shape (two nearby positive numbers),
        // but close enough together that t clears even df=1's 12.706 critical value.
        const result = pairedDelta([0, 0], [10, 11]);
        expect(result.n).toBe(2);
        expect(Math.abs(result.mean / result.se)).toBeGreaterThan(12.706);
        expect(result.distinguishable).toBe(true);
    });
});

describe('studentTCritical95', () => {
    it('reads an exact table entry', () => {
        expect(studentTCritical95(19)).toBe(2.093);
    });

    it('reads the next LOWER df entry when df falls between table points, not an interpolation', () => {
        // df=35 sits between the df=30 (2.042) and df=40 (2.021) rows; the rule takes the
        // more conservative (larger) of the two, which is the lower df's value.
        expect(studentTCritical95(35)).toBe(2.042);
    });

    it('reads the exact df=100 row, then falls back to the asymptotic value past it', () => {
        expect(studentTCritical95(100)).toBe(1.984);
        expect(studentTCritical95(101)).toBe(1.96);
        expect(studentTCritical95(10000)).toBe(1.96);
    });

    it('reads the most extreme table entry, df=1', () => {
        expect(studentTCritical95(1)).toBe(12.706);
    });
});

describe('binomialTailProbability', () => {
    it('stays finite, non-zero and correctly ordered at the simulator run-count ceiling', () => {
        // Binds the running-ratio recurrence to MAX_RUN_COUNT (`seedRunInputs.ts`): raising the
        // ceiling past what this arithmetic supports (it underflows to exactly 0 past m=1074)
        // should trip this test rather than silently making every large comparison
        // "distinguishable".
        const centre = binomialTailProbability(MAX_RUN_COUNT, Math.floor(MAX_RUN_COUNT / 2));
        const extreme = binomialTailProbability(MAX_RUN_COUNT, MAX_RUN_COUNT);
        expect(Number.isFinite(centre)).toBe(true);
        expect(centre).toBeGreaterThan(0);
        expect(Number.isFinite(extreme)).toBe(true);
        expect(extreme).toBeGreaterThan(0);
        // A more extreme split is less probable than a near-even one.
        expect(extreme).toBeLessThan(centre);
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
