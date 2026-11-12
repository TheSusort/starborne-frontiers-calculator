import React from 'react';
import { MeterBar } from '../ui/MeterBar';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import type { ActorTotals } from '../../utils/simulator/seededRuns';
import { formatWhole, rosterLabels } from '../../utils/simulator/runBreakdown';

interface Props {
    roster: BattleResult['roster'];
    /** Mean per-fight totals, keyed by actorId. A rostered ship with no entry reads as zero. */
    perActorMean: Record<string, ActorTotals>;
}

type Side = 'player' | 'enemy';
type Metric = keyof ActorTotals;

const ZERO: ActorTotals = { damageDealt: 0, damageTaken: 0, healingDone: 0 };

const SIDES: ReadonlyArray<{ side: Side; title: string }> = [
    { side: 'player', title: 'Your team' },
    { side: 'enemy', title: 'Enemy' },
];

const COLUMNS: ReadonlyArray<{ metric: Metric; heading: string; barLabel: string }> = [
    { metric: 'damageDealt', heading: 'Avg damage dealt', barLabel: 'average damage dealt' },
    { metric: 'damageTaken', heading: 'Avg damage taken', barLabel: 'average damage taken' },
    { metric: 'healingDone', heading: 'Avg healing done', barLabel: 'average healing done' },
];

/** Damage dealt is coloured by the side that dealt it; the other columns read the same on both. */
const barColor = (metric: Metric, side: Side): string => {
    if (metric === 'damageDealt') return side === 'player' ? 'bg-blue-500' : 'bg-red-500';
    return metric === 'damageTaken' ? 'bg-amber-500' : 'bg-green-500';
};

/** Per-ship means for a multi-seed run, grouped by side. Each number carries a bar scaled to its
 *  column's largest value across every row, so bars compare ships within a column, not across
 *  columns. */
const ShipBreakdownTable: React.FC<Props> = ({ roster, perActorMean }) => {
    const labels = rosterLabels(roster);
    const totalsFor = (actorId: string) => perActorMean[actorId] ?? ZERO;

    const columnMax = (metric: Metric) =>
        roster.reduce((max, entry) => Math.max(max, totalsFor(entry.actorId)[metric]), 0);
    const maxima: Record<Metric, number> = {
        damageDealt: columnMax('damageDealt'),
        damageTaken: columnMax('damageTaken'),
        healingDone: columnMax('healingDone'),
    };

    return (
        <div className="card overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-theme-text-secondary">
                        <th scope="col" className="py-2 pr-3 font-medium">
                            Ship
                        </th>
                        {COLUMNS.map((column) => (
                            <th
                                key={column.metric}
                                scope="col"
                                className="py-2 px-3 text-right font-medium whitespace-nowrap"
                            >
                                {column.heading}
                            </th>
                        ))}
                    </tr>
                </thead>
                <>
                    {SIDES.map(({ side, title }) => {
                        const rows = roster.filter((entry) => entry.side === side);
                        if (rows.length === 0) return null;
                        return (
                            <tbody key={side}>
                                <tr>
                                    <th
                                        scope="rowgroup"
                                        colSpan={COLUMNS.length + 1}
                                        className="pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-theme-text-secondary"
                                    >
                                        {title}
                                    </th>
                                </tr>
                                {rows.map((entry) => {
                                    const label = labels.get(entry.actorId) ?? entry.name;
                                    const totals = totalsFor(entry.actorId);
                                    return (
                                        <tr
                                            key={entry.actorId}
                                            className="border-t border-dark-border"
                                        >
                                            <th
                                                scope="row"
                                                className="py-1.5 pr-3 text-left font-normal whitespace-nowrap"
                                            >
                                                {label}
                                            </th>
                                            {COLUMNS.map((column) => {
                                                const value = totals[column.metric];
                                                const max = maxima[column.metric];
                                                return (
                                                    <td key={column.metric} className="py-1.5 px-3">
                                                        <div className="flex flex-col items-end gap-1">
                                                            <span className="tabular-nums">
                                                                {formatWhole(value)}
                                                            </span>
                                                            <MeterBar
                                                                percentage={
                                                                    max > 0
                                                                        ? (value / max) * 100
                                                                        : 0
                                                                }
                                                                label={`${label} ${column.barLabel}`}
                                                                fillClassName={barColor(
                                                                    column.metric,
                                                                    side
                                                                )}
                                                                className="!h-1 !w-16"
                                                            />
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        );
                    })}
                </>
            </table>
        </div>
    );
};

export default ShipBreakdownTable;
