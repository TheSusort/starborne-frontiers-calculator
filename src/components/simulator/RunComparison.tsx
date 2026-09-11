import React from 'react';
import { DataTable, type Column } from '../ui/tables/DataTable';
import {
    diffOverrides,
    rostersDiffer,
    type OverrideSnapshot,
    type PinnedBaseline,
} from '../../utils/simulator/compareRuns';
import type { SeedSetAggregate } from '../../utils/simulator/seededRuns';
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

interface ScalarRow {
    metric: string;
    baselineValue: number;
    currentValue: number;
    decimals: number;
    direction: Direction;
}

/** One actor's baseline vs. current mean total for one metric, plus whether a higher value
 *  favours the player side (depends on both the metric and which side the actor is on). */
interface ActorMetricCell {
    baselineValue: number;
    currentValue: number;
    direction: Direction;
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

/** Stacked baseline / current / delta cell used by both the actor and scalar tables. */
const DeltaCell: React.FC<{
    baselineValue: number;
    currentValue: number;
    direction: Direction;
}> = ({ baselineValue, currentValue, direction }) => (
    <div className="flex flex-col items-end gap-0.5">
        <span className="text-xs text-theme-text-secondary">{baselineValue.toFixed(0)}</span>
        <span>{currentValue.toFixed(0)}</span>
        <span className={deltaColorClass(currentValue - baselineValue, direction)}>
            {formatSigned(currentValue - baselineValue, 0)}
        </span>
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

    const scalarRows: ScalarRow[] = [
        {
            metric: 'Player wins',
            baselineValue: baseline.aggregate.wins.player,
            currentValue: current.wins.player,
            decimals: 0,
            direction: 'higherGood',
        },
        {
            metric: 'Enemy wins',
            baselineValue: baseline.aggregate.wins.enemy,
            currentValue: current.wins.enemy,
            decimals: 0,
            direction: 'lowerGood',
        },
        {
            metric: 'Draws',
            baselineValue: baseline.aggregate.wins.draw,
            currentValue: current.wins.draw,
            decimals: 0,
            direction: 'neutral',
        },
        {
            metric: 'Mean rounds',
            baselineValue: baseline.aggregate.meanRounds,
            currentValue: current.meanRounds,
            decimals: 1,
            direction: 'neutral',
        },
        {
            metric: 'Median rounds',
            baselineValue: baseline.aggregate.medianRounds,
            currentValue: current.medianRounds,
            decimals: 0,
            direction: 'neutral',
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
            render: (row) => (
                <span
                    className={deltaColorClass(row.currentValue - row.baselineValue, row.direction)}
                >
                    {formatSigned(row.currentValue - row.baselineValue, row.decimals)}
                </span>
            ),
        },
    ];

    const actorIds = Array.from(
        new Set([
            ...Object.keys(baseline.aggregate.perActorMean),
            ...Object.keys(current.perActorMean),
        ])
    );

    const actorRows: ActorRow[] = actorIds.map((actorId) => {
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
