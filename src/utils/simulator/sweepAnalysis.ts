import { pairedDelta, type PairedDelta } from './deltaStats';
import type { SeedSetAggregate } from './seededRuns';
import type { SweepResult } from './statSweep';

export type SweepSeries = 'winRate' | 'meanRounds' | 'playerDamage';

export interface SweepPoint {
    value: number;
    isReference: boolean;
    winRate: number;
    meanRounds: number;
    playerDamage: number;
    /** Absent on the reference step: it is the origin every other step is measured from, and a
     *  series compared against itself is a degenerate zero that would render as a verdict. */
    deltas?: Record<SweepSeries, PairedDelta>;
}

/** Total damage dealt by the player side in one seed, summed across its actors. Sweeping a
 *  support's speed is meant to show the TEAM hitting harder; a focus-only figure reports that as
 *  zero. */
const playerDamagePerSeed = (aggregate: SeedSetAggregate): number[] => {
    const playerActorIds = aggregate.roster
        .filter((entry) => entry.side === 'player')
        .map((entry) => entry.actorId);
    return aggregate.runs.map((run) =>
        playerActorIds.reduce(
            (total, actorId) => total + (run.perActor[actorId]?.damageDealt ?? 0),
            0
        )
    );
};

const winIndicatorPerSeed = (aggregate: SeedSetAggregate): number[] =>
    aggregate.runs.map((run) => (run.winner === 'player' ? 1 : 0));

const roundsPerSeed = (aggregate: SeedSetAggregate): number[] =>
    aggregate.runs.map((run) => run.lastRound);

const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Collapse a sweep into plottable points, each tested against the reference step.
 *
 * Pairing is valid because every step ran the SAME seed set, so seed *i* of a step and seed *i*
 * of the reference are the same fight under two configurations.
 *
 * The metric kind is a property of the metric, never inferred from how a particular pair of runs
 * landed: a win/draw indicator takes the exact sign test whatever its spread, and rounds take the
 * paired t rule even when every seed moved by at most one round.
 */
export function analyseSweep(result: SweepResult): SweepPoint[] {
    const reference = result.steps.find((step) => step.isReference);

    return result.steps.map((step) => {
        const wins = winIndicatorPerSeed(step.aggregate);
        const rounds = roundsPerSeed(step.aggregate);
        const damage = playerDamagePerSeed(step.aggregate);

        const point: SweepPoint = {
            value: step.value,
            isReference: step.isReference,
            winRate: mean(wins),
            meanRounds: mean(rounds),
            playerDamage: mean(damage),
        };

        if (!reference || step.isReference) return point;

        point.deltas = {
            winRate: pairedDelta(winIndicatorPerSeed(reference.aggregate), wins, 'binary'),
            meanRounds: pairedDelta(roundsPerSeed(reference.aggregate), rounds, 'continuous'),
            playerDamage: pairedDelta(
                playerDamagePerSeed(reference.aggregate),
                damage,
                'continuous'
            ),
        };
        return point;
    });
}
