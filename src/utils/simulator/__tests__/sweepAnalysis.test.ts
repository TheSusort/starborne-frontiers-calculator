import { describe, it, expect } from 'vitest';
import { analyseSweep } from '../sweepAnalysis';
import { pairedDelta } from '../deltaStats';
import type { SweepResult } from '../statSweep';
import type { SeedRunSummary, SeedSetAggregate } from '../seededRuns';

const roster = [
    { actorId: 'p:a:0', side: 'player' as const, name: 'A', position: 'T1' as const },
    { actorId: 'p:b:1', side: 'player' as const, name: 'B', position: 'M1' as const },
    { actorId: 'e:c:0', side: 'enemy' as const, name: 'C', position: 'T1' as const },
];

/** winners[i] is seed i's winner; damage[i] is EACH player actor's damage that seed. */
const aggregate = (winners: ('player' | 'enemy')[], rounds: number[], damage: number[]) => {
    const runs: SeedRunSummary[] = winners.map((winner, i) => ({
        seed: 100 + i,
        winner,
        lastRound: rounds[i],
        perActor: {
            'p:a:0': { damageDealt: damage[i], damageTaken: 0, healingDone: 0 },
            'p:b:1': { damageDealt: damage[i], damageTaken: 0, healingDone: 0 },
            'e:c:0': { damageDealt: 999, damageTaken: 0, healingDone: 0 },
        },
    }));
    const wins = { player: 0, enemy: 0, draw: 0 };
    for (const run of runs) wins[run.winner]++;
    return {
        baseSeed: 100,
        count: runs.length,
        roster,
        runs,
        wins,
        meanRounds: rounds.reduce((a, b) => a + b, 0) / rounds.length,
        medianRounds: 0,
        perActorMean: {},
    } as SeedSetAggregate;
};

const sweep = (steps: { value: number; isReference: boolean; aggregate: SeedSetAggregate }[]) =>
    ({
        stat: 'speed',
        target: { side: 'player', position: 'T1' },
        baseSeed: 100,
        count: steps[0].aggregate.count,
        steps,
    }) as SweepResult;

const W = 'player' as const;
const L = 'enemy' as const;

describe('analyseSweep', () => {
    it('sums player-side damage across actors and excludes the enemy', () => {
        const points = analyseSweep(
            sweep([
                { value: 100, isReference: true, aggregate: aggregate([W, W], [5, 5], [10, 20]) },
            ])
        );
        // Two player actors at 10 and 20 per seed -> 20 and 40 per seed -> mean 30.
        expect(points[0].playerDamage).toBe(30);
    });

    it('reports win rate as player wins over the seed count', () => {
        const points = analyseSweep(
            sweep([
                {
                    value: 100,
                    isReference: true,
                    aggregate: aggregate([W, L, W, W], [5, 5, 5, 5], [1, 1, 1, 1]),
                },
            ])
        );
        expect(points[0].winRate).toBe(0.75);
    });

    it('gives the reference step no deltas', () => {
        const points = analyseSweep(
            sweep([{ value: 100, isReference: true, aggregate: aggregate([W, L], [5, 6], [1, 2]) }])
        );
        expect(points[0].deltas).toBeUndefined();
    });

    it('calls a real difference distinguishable', () => {
        // The per-seed DIFFERENCES must vary. All-identical differences give se = 0, and then the
        // verdict turns on how pairedDelta handles mean/0 rather than on the rule being tested.
        const spread = (a: number, b: number) =>
            Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b));
        const base = aggregate(Array(12).fill(L), spread(10, 11), spread(100, 120));
        const better = aggregate(Array(12).fill(W), spread(4, 6), spread(900, 860));
        const points = analyseSweep(
            sweep([
                { value: 100, isReference: true, aggregate: base },
                { value: 200, isReference: false, aggregate: better },
            ])
        );
        expect(points[1].deltas!.winRate.distinguishable).toBe(true);
        expect(points[1].deltas!.meanRounds.distinguishable).toBe(true);
        expect(points[1].deltas!.playerDamage.distinguishable).toBe(true);
    });

    it('calls a coin flip not distinguishable', () => {
        const base = aggregate(
            [W, L, W, L, W, L, W, L, W, L, W, L],
            [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11],
            [100, 110, 100, 110, 100, 110, 100, 110, 100, 110, 100, 110]
        );
        const same = aggregate(
            [L, W, W, L, L, W, W, L, W, L, L, W],
            [11, 10, 10, 11, 11, 10, 10, 11, 10, 11, 11, 10],
            [110, 100, 100, 110, 110, 100, 100, 110, 100, 110, 110, 100]
        );
        const points = analyseSweep(
            sweep([
                { value: 100, isReference: true, aggregate: base },
                { value: 200, isReference: false, aggregate: same },
            ])
        );
        expect(points[1].deltas!.winRate.distinguishable).toBe(false);
    });

    describe('win rate takes the sign test, not the t rule', () => {
        // Four seeds of twelve flip to a win, all in the same direction, the rest unchanged.
        const baseWinners = [L, L, L, L, W, W, W, W, W, W, W, W];
        const flippedWinners = [W, W, W, W, W, W, W, W, W, W, W, W];
        const indicators = (winners: ('player' | 'enemy')[]) =>
            winners.map((winner) => (winner === 'player' ? 1 : 0));

        it('is a fixture the two rules disagree on', () => {
            // Without this the test below would pass against an implementation that routes win
            // rate through the continuous path, because both rules would agree on the fixture.
            const asContinuous = pairedDelta(
                indicators(baseWinners),
                indicators(flippedWinners),
                'continuous'
            );
            expect(asContinuous.distinguishable).toBe(true);
        });

        it('rates four same-direction flips out of twelve a coin flip', () => {
            const base = aggregate(baseWinners, Array(12).fill(10), Array(12).fill(100));
            const flipped = aggregate(flippedWinners, Array(12).fill(10), Array(12).fill(100));
            const points = analyseSweep(
                sweep([
                    { value: 100, isReference: true, aggregate: base },
                    { value: 200, isReference: false, aggregate: flipped },
                ])
            );
            expect(points[1].deltas!.winRate.distinguishable).toBe(false);
        });
    });
});
