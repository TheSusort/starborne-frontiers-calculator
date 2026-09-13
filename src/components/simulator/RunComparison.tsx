import React, { useMemo } from 'react';
import { DataTable, type Column } from '../ui/tables/DataTable';
import {
    diffOverrides,
    rostersDiffer,
    type OverrideSnapshot,
    type PinnedBaseline,
} from '../../utils/simulator/compareRuns';
import type { SeedSetAggregate } from '../../utils/simulator/seededRuns';
import {
    pairedDelta,
    pairedSeries,
    scalePairedDelta,
    type PairedDelta,
} from '../../utils/simulator/deltaStats';
import { STATS } from '../../constants/stats';
import type { StatName } from '../../types/stats';

interface Props {
    baseline: PinnedBaseline;
    current: SeedSetAggregate;
    currentOverrides: OverrideSnapshot;
}

/** Human label for an override-diff row's stat key, falling back to the raw key for anything
 *  outside `STATS` (there shouldn't be any — overrides are only ever written for `STATS` keys). */
const statLabel = (stat: string): string => STATS[stat as StatName]?.label ?? stat;

/** A signed delta's colour: green when it favours the player side, red when it costs the player
 *  side, and neutral when the metric carries no inherent direction (e.g. round count). */
type Direction = 'higherGood' | 'lowerGood' | 'neutral';

function deltaColorClass(delta: number, direction: Direction): string {
    if (delta === 0 || direction === 'neutral') return 'text-theme-text-secondary';
    const favoursPlayer = direction === 'higherGood' ? delta > 0 : delta < 0;
    return favoursPlayer ? 'text-green-400' : 'text-red-400';
}

function formatSigned(delta: number, decimals: number): string {
    const rounded = delta.toFixed(decimals);
    return delta > 0 ? `+${rounded}` : rounded;
}

/** Every paired delta renders to one decimal place, spread included. A win count is a whole
 *  number but its uncertainty is not, and "+5 ±0" would be a lie about a spread of 0.4. */
const DELTA_DECIMALS = 1;

/** Renders a paired delta, or refuses to. A delta the seed set cannot separate from noise gets
 *  no sign and no colour — colour is a claim about direction, and an indistinguishable delta has
 *  not earned one. A delta with no spread and no mean difference is a third case, not a variant of
 *  the first: the two configurations produced an identical figure, so it renders as a plain
 *  neutral zero rather than the noise wording. */
const PairedDeltaText: React.FC<{ delta: PairedDelta; direction: Direction }> = ({
    delta,
    direction,
}) => {
    if (delta.se === 0 && delta.mean === 0) {
        return (
            <span className="text-theme-text-secondary">
                {formatSigned(delta.mean, DELTA_DECIMALS)}
            </span>
        );
    }
    if (!delta.distinguishable) {
        return (
            <span className="text-theme-text-secondary">not distinguishable at {delta.n} runs</span>
        );
    }
    return (
        <span className={deltaColorClass(delta.mean, direction)}>
            {formatSigned(delta.mean, DELTA_DECIMALS)} ±{delta.se.toFixed(DELTA_DECIMALS)}
        </span>
    );
};

interface ScalarRow {
    metric: string;
    baselineValue: number;
    currentValue: number;
    decimals: number;
    direction: Direction;
    delta: PairedDelta | null;
}

/** One actor's baseline vs. current mean total for one metric, plus whether a higher value
 *  favours the player side (depends on both the metric and which side the actor is on). */
interface ActorMetricCell {
    baselineValue: number;
    currentValue: number;
    direction: Direction;
    delta: PairedDelta;
}

/** One row per actor: its name plus a cell per tracked metric, each holding both
 *  configurations' means so the table stays four columns wide regardless of metric count. */
interface ActorRow {
    actorId: string;
    name: string;
    damageDealt: ActorMetricCell;
    damageTaken: ActorMetricCell;
    healingDone: ActorMetricCell;
}

const ACTOR_METRICS: Array<{
    key: 'damageDealt' | 'damageTaken' | 'healingDone';
    label: string;
    /** Whether more of this stat favours the player side WHEN the actor is on the player side. */
    higherGoodForOwnSide: boolean;
}> = [
    { key: 'damageDealt', label: 'Damage Dealt', higherGoodForOwnSide: true },
    { key: 'damageTaken', label: 'Damage Taken', higherGoodForOwnSide: false },
    { key: 'healingDone', label: 'Healing Done', higherGoodForOwnSide: true },
];

/** Stacked baseline / current / delta cell used by the actor table. */
const DeltaCell: React.FC<ActorMetricCell> = ({
    baselineValue,
    currentValue,
    direction,
    delta,
}) => (
    <div className="flex flex-col items-end gap-0.5">
        <span className="text-xs text-theme-text-secondary">{baselineValue.toFixed(0)}</span>
        <span>{currentValue.toFixed(0)}</span>
        <PairedDeltaText delta={delta} direction={direction} />
    </div>
);

/**
 * Compares a pinned baseline seed-set aggregate against the current one: win split, mean/median
 * rounds, per-actor mean totals, and the override changes that produced the variant. The seed and
 * run count shown come from `baseline.aggregate`, the actual seed set both configurations share.
 */
const RunComparison: React.FC<Props> = ({ baseline, current, currentOverrides }) => {
    const nameFor = (actorId: string) =>
        current.roster.find((r) => r.actorId === actorId)?.name ?? actorId;
    const sideFor = (actorId: string) =>
        current.roster.find((r) => r.actorId === actorId)?.side ?? 'player';

    // Both aggregates ran the same seed set (effectiveRunParams guarantees it while a baseline
    // is pinned), so every figure below is a PAIRED difference: seed i against seed i. This walks
    // both `runs` arrays once per metric, so it is memoized against the two aggregates rather than
    // recomputed on every render — this component re-renders on every progress tick of a run in
    // flight.
    const deltas = useMemo(() => {
        const actorIds = Array.from(
            new Set([
                ...Object.keys(baseline.aggregate.perActorMean),
                ...Object.keys(current.perActorMean),
            ])
        );

        const winDelta = (side: 'player' | 'enemy' | 'draw'): PairedDelta => {
            const series = pairedSeries(baseline.aggregate, current, (run) =>
                run.winner === side ? 1 : 0
            );
            const delta = pairedDelta(series.baseline, series.current, 'binary');
            // The per-seed value is a 0/1 indicator, so its mean is a win RATE. Scale to the
            // wins-out-of-N the rest of the row is written in, using the paired series' own
            // length so the scale factor always matches the figure the delta came from — see
            // `scalePairedDelta` for why the verdict survives the rescale.
            return scalePairedDelta(delta, delta.n);
        };

        const roundsDelta = (() => {
            const series = pairedSeries(baseline.aggregate, current, (run) => run.lastRound);
            return pairedDelta(series.baseline, series.current);
        })();

        const actorDelta = (
            actorId: string,
            key: 'damageDealt' | 'damageTaken' | 'healingDone'
        ): PairedDelta => {
            const series = pairedSeries(
                baseline.aggregate,
                current,
                (run) => run.perActor[actorId]?.[key] ?? 0
            );
            return pairedDelta(series.baseline, series.current);
        };

        return {
            actorIds,
            playerWins: winDelta('player'),
            enemyWins: winDelta('enemy'),
            drawWins: winDelta('draw'),
            rounds: roundsDelta,
            actors: Object.fromEntries(
                actorIds.map((actorId) => [
                    actorId,
                    Object.fromEntries(
                        ACTOR_METRICS.map(({ key }) => [key, actorDelta(actorId, key)])
                    ),
                ])
            ) as Record<string, Record<'damageDealt' | 'damageTaken' | 'healingDone', PairedDelta>>,
        };
    }, [baseline.aggregate, current]);

    const scalarRows: ScalarRow[] = [
        {
            metric: 'Player wins',
            baselineValue: baseline.aggregate.wins.player,
            currentValue: current.wins.player,
            decimals: 0,
            direction: 'higherGood',
            delta: deltas.playerWins,
        },
        {
            metric: 'Enemy wins',
            baselineValue: baseline.aggregate.wins.enemy,
            currentValue: current.wins.enemy,
            decimals: 0,
            direction: 'lowerGood',
            delta: deltas.enemyWins,
        },
        {
            metric: 'Draws',
            baselineValue: baseline.aggregate.wins.draw,
            currentValue: current.wins.draw,
            decimals: 0,
            direction: 'neutral',
            delta: deltas.drawWins,
        },
        {
            metric: 'Mean rounds',
            baselineValue: baseline.aggregate.meanRounds,
            currentValue: current.meanRounds,
            decimals: 1,
            direction: 'neutral',
            delta: deltas.rounds,
        },
        {
            metric: 'Median rounds',
            baselineValue: baseline.aggregate.medianRounds,
            currentValue: current.medianRounds,
            decimals: 0,
            direction: 'neutral',
            delta: null,
        },
    ];

    const scalarColumns: Column<ScalarRow>[] = [
        { key: 'metric', label: 'Metric', render: (row) => row.metric },
        {
            key: 'baseline',
            label: 'Baseline',
            align: 'right',
            render: (row) => row.baselineValue.toFixed(row.decimals),
        },
        {
            key: 'current',
            label: 'Current',
            align: 'right',
            render: (row) => row.currentValue.toFixed(row.decimals),
        },
        {
            key: 'delta',
            label: 'Delta',
            align: 'right',
            render: (row) =>
                row.delta ? (
                    <PairedDeltaText delta={row.delta} direction={row.direction} />
                ) : (
                    <span
                        className={deltaColorClass(
                            row.currentValue - row.baselineValue,
                            row.direction
                        )}
                    >
                        {formatSigned(row.currentValue - row.baselineValue, row.decimals)}
                    </span>
                ),
        },
    ];

    const actorRows: ActorRow[] = deltas.actorIds.map((actorId) => {
        const isPlayerActor = sideFor(actorId) === 'player';
        const baselineTotals = baseline.aggregate.perActorMean[actorId];
        const currentTotals = current.perActorMean[actorId];
        const cells = Object.fromEntries(
            ACTOR_METRICS.map(({ key, higherGoodForOwnSide }) => [
                key,
                {
                    baselineValue: baselineTotals?.[key] ?? 0,
                    currentValue: currentTotals?.[key] ?? 0,
                    direction: isPlayerActor === higherGoodForOwnSide ? 'higherGood' : 'lowerGood',
                    delta: deltas.actors[actorId][key],
                },
            ])
        ) as Record<'damageDealt' | 'damageTaken' | 'healingDone', ActorMetricCell>;
        return { actorId, name: nameFor(actorId), ...cells };
    });

    const actorColumns: Column<ActorRow>[] = [
        { key: 'actor', label: 'Actor', render: (row) => row.name },
        ...ACTOR_METRICS.map(({ key, label }): Column<ActorRow> => ({
            key,
            label,
            align: 'right',
            render: (row) => <DeltaCell {...row[key]} />,
        })),
    ];

    const diffRows = diffOverrides(baseline.overrides, currentOverrides);
    const diffColumns: Column<(typeof diffRows)[number]>[] = [
        // `key` is "<side>:<position>" (see snapshotOverrides) — split so the table reads as
        // two plain columns instead of the internal composite key.
        { key: 'side', label: 'Side', render: (row) => row.key.split(':')[0] },
        { key: 'position', label: 'Position', render: (row) => row.key.split(':')[1] },
        { key: 'stat', label: 'Stat', render: (row) => statLabel(row.stat) },
        { key: 'from', label: 'From', align: 'right', render: (row) => row.from ?? '—' },
        { key: 'to', label: 'To', align: 'right', render: (row) => row.to ?? '—' },
    ];

    const rosterChanged = rostersDiffer(baseline.aggregate.roster, current.roster);

    // The median is the robust one. When it moves opposite the (paired, distinguishable) mean,
    // the round-count distribution is skewed and the mean is the figure to distrust. Reads the
    // same `deltas.rounds` the Mean rounds row renders, so the banner and that row can never
    // disagree about the same figure.
    const medianRoundsDelta = current.medianRounds - baseline.aggregate.medianRounds;
    const roundsDisagree =
        deltas.rounds.distinguishable &&
        medianRoundsDelta !== 0 &&
        Math.sign(deltas.rounds.mean) !== Math.sign(medianRoundsDelta);

    return (
        <div className="card space-y-4">
            <h2 className="text-lg font-semibold">Baseline Comparison</h2>
            <p className="text-sm text-theme-text-secondary">
                Base seed {baseline.aggregate.baseSeed} over {baseline.aggregate.count} runs — the
                same seed set on both sides.
            </p>

            {rosterChanged && (
                <div className="card border-amber-500/40 text-sm text-amber-400">
                    The roster changed since the baseline was pinned (a ship was added, removed, or
                    moved to a different position). Per-actor figures below may compare different
                    ships rather than the same ship before and after — pin a new baseline before
                    trusting this comparison.
                </div>
            )}

            {roundsDisagree && (
                <div className="card border-amber-500/40 text-sm text-amber-400">
                    Mean and median rounds moved in opposite directions: the round-count
                    distribution is skewed, so the median is the more reliable figure.
                </div>
            )}

            <DataTable data={scalarRows} columns={scalarColumns} getRowKey={(row) => row.metric} />

            <DataTable
                data={actorRows}
                columns={actorColumns}
                getRowKey={(row) => row.actorId}
                emptyMessage="No actor data"
            />

            <DataTable
                data={diffRows}
                columns={diffColumns}
                getRowKey={(row) => `${row.key}:${row.stat}`}
                emptyMessage="No stat differences between the baseline and current overrides"
            />
        </div>
    );
};

export default RunComparison;
