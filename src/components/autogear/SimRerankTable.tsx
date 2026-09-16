import React from 'react';
import { Button } from '../ui';
import { DataTable, type Column } from '../ui/tables';
import { SHIP_TYPES, type ShipTypeName } from '../../constants';
import {
    METRIC_LABELS,
    METRIC_LOWER_IS_BETTER,
    SIM_METRICS,
    type CandidateRow,
    type MetricCell,
    type SimMetric,
} from '../../utils/autogear/simRerank/metricTable';
import type { CandidateRank, SimRerankRow } from '../../hooks/useSimRerank';

/** Names which role and standing (autogear's best, or a numbered runner-up) a build came from,
 *  marking the ship's own role so a reader can tell "what I already have" from "an added role".
 *  Shared with `SimRerankSection`, which is why this file exports a function alongside a
 *  component — same tradeoff `SeedRunControls.tsx` makes for `randomSeed`. */
// eslint-disable-next-line react-refresh/only-export-components
export function roleRankLabel(
    ownRole: ShipTypeName | undefined,
    role: ShipTypeName,
    rank: CandidateRank
): string {
    const roleName = SHIP_TYPES[role]?.name ?? role;
    const base = role === ownRole ? `${roleName} (current role)` : roleName;
    return rank === 'best' ? base : `${base}, alt ${rank.alt}`;
}

/** A metric's delta favours the candidate by shrinking for `focusDamageTaken`/`rounds` and by
 *  growing for everything else — see `METRIC_LOWER_IS_BETTER`'s doc. */
const isImprovement = (cell: MetricCell): boolean =>
    METRIC_LOWER_IS_BETTER[cell.metric] ? cell.mean < 0 : cell.mean > 0;

/** The score a sort orders by: the raw mean for a grow-to-improve metric, negated for a
 *  shrink-to-improve one, so "descending" always reads as "candidate ahead of baseline first"
 *  regardless of which direction that metric's numbers move in. */
// eslint-disable-next-line react-refresh/only-export-components
export const metricSortScore = (cell: MetricCell): number =>
    METRIC_LOWER_IS_BETTER[cell.metric] ? -cell.mean : cell.mean;

function formatMetricDelta(cell: MetricCell): string {
    const sign = cell.mean > 0 ? '+' : cell.mean < 0 ? '' : '±';
    if (cell.metric === 'winRate') return `${sign}${(cell.mean * 100).toFixed(0)}%`;
    if (cell.metric === 'rounds') return `${sign}${cell.mean.toFixed(1)}`;
    return `${sign}${Math.round(cell.mean).toLocaleString()}`;
}

export interface SimRerankTableRow {
    row: SimRerankRow;
    cells: CandidateRow['cells'];
}

interface SimRerankTableProps {
    ownRole: ShipTypeName | undefined;
    rows: SimRerankTableRow[];
    suggestedPrimary: SimMetric;
    sortMetric: SimMetric;
    sortDirection: 'asc' | 'desc';
    onSort: (metric: SimMetric) => void;
    onApply: (row: SimRerankRow) => void;
}

/**
 * The candidate comparison results: one row per surviving build, every metric shown for every
 * role (ranking a controller on any single column is the "confident wrong answer" the feature
 * exists to avoid), each a paired delta against the equipped baseline. No overall winner is ever
 * marked — only the suggested-primary column that the initial sort uses.
 */
export const SimRerankTable: React.FC<SimRerankTableProps> = ({
    ownRole,
    rows,
    suggestedPrimary,
    sortMetric,
    sortDirection,
    onSort,
    onApply,
}) => {
    const columns: Column<SimRerankTableRow>[] = [
        {
            key: 'source',
            label: 'Build',
            render: (item) => roleRankLabel(ownRole, item.row.role, item.row.rank),
        },
        ...SIM_METRICS.map((metric): Column<SimRerankTableRow> => ({
            key: metric,
            label:
                metric === suggestedPrimary
                    ? `${METRIC_LABELS[metric]} (suggested)`
                    : METRIC_LABELS[metric],
            sortable: true,
            align: 'right',
            render: (item) => {
                const cell = item.cells[metric];
                if (!cell.distinguishable) {
                    return <span className="text-theme-text-secondary">No clear difference</span>;
                }
                return (
                    <span className={isImprovement(cell) ? 'text-green-400' : 'text-red-400'}>
                        {formatMetricDelta(cell)}
                    </span>
                );
            },
        })),
        {
            key: 'apply',
            label: '',
            align: 'right',
            render: (item) => (
                <Button size="sm" variant="secondary" onClick={() => onApply(item.row)}>
                    Apply
                </Button>
            ),
        },
    ];

    return (
        <DataTable
            data={rows}
            columns={columns}
            getRowKey={(item) => item.row.id}
            onSort={(field) => onSort(field as SimMetric)}
            sortBy={sortMetric}
            sortDirection={sortDirection}
            emptyMessage="No candidates to compare yet."
        />
    );
};
