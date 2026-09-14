import React from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import {
    BaseChart,
    ChartLegend,
    CHART_LINE_COLORS,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../ui/charts';
import type { SweepPoint, SweepSeries } from '../../utils/simulator/sweepAnalysis';

interface StatSweepChartProps {
    points: SweepPoint[];
    series: SweepSeries;
    /** The swept stat's display name, for the x-axis and the tooltip. */
    statLabel: string;
    height?: number;
}

const SERIES_LABELS: Record<SweepSeries, string> = {
    winRate: 'Win rate',
    meanRounds: 'Mean rounds',
    playerDamage: 'Player damage dealt',
};

const formatMetric = (series: SweepSeries, metric: number): string =>
    series === 'winRate' ? `${Math.round(metric * 100)}%` : metric.toFixed(1);

/** Win rate is a proportion and owns the full 0-100% range; every other series is a magnitude
 *  measured from zero. Neither ever crops to the observed spread — an axis fitted to the data
 *  redraws a couple of wins' wobble as a dramatic curve. */
const yAxisDomain = (series: SweepSeries): [number, number | 'auto'] =>
    series === 'winRate' ? [0, 1] : [0, 'auto'];

const SERIES_COLOR = CHART_LINE_COLORS[0];
const MUTED_COLOR = '#6b7280';
const CHART_GROUND = '#141414';

interface SweepChartRow extends Record<string, unknown> {
    value: number;
    metric: number;
    isReference: boolean;
    /** The verdict for the series ON SCREEN. A point carries one verdict per series, so a marker
     *  keyed to anything but the displayed one reports a difference the reader is not looking at. */
    distinguishable: boolean;
}

const toRow = (point: SweepPoint, series: SweepSeries): SweepChartRow => ({
    value: point.value,
    metric: point[series],
    isReference: point.isReference,
    distinguishable: point.deltas?.[series].distinguishable ?? false,
});

interface SweepDotProps {
    cx?: number;
    cy?: number;
    payload?: SweepChartRow;
}

/**
 * One plotted step.
 *
 * `chartLineDefaults` sets `dot: false`, so the sweep passes its own renderer: the marker, not
 * the line, is what carries the reading. A step whose difference from the reference cleared its
 * test renders solid; one that did not renders hollow, because a curve drawn through
 * indistinguishable points is a shape the data does not support.
 */
const renderSweepDot = ({ cx, cy, payload }: SweepDotProps): React.ReactElement => {
    // recharts types `dot` as returning an element, never null, so an unplaceable point renders
    // as an empty group rather than nothing.
    if (cx === undefined || cy === undefined || !payload) return <g />;
    const { isReference, distinguishable } = payload;
    const solid = isReference || distinguishable;
    return (
        <circle
            data-testid="sweep-point"
            data-value={payload.value}
            data-reference={String(isReference)}
            data-distinguishable={isReference ? 'reference' : String(distinguishable)}
            cx={cx}
            cy={cy}
            r={isReference ? 6 : 5}
            fill={solid ? (isReference ? '#ffffff' : SERIES_COLOR) : CHART_GROUND}
            stroke={isReference ? '#ffffff' : distinguishable ? SERIES_COLOR : MUTED_COLOR}
            strokeWidth={2}
        />
    );
};

interface TooltipRowProps {
    active?: boolean;
    payload?: Array<{ payload: SweepChartRow }>;
    series: SweepSeries;
    statLabel: string;
}

const SweepTooltip: React.FC<TooltipRowProps> = ({ active, payload, series, statLabel }) => {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    return (
        <div className="card text-sm space-y-1">
            <p className="font-semibold">
                {statLabel} {row.value}
                {row.isReference && ' (current value)'}
            </p>
            <p>
                {SERIES_LABELS[series]}: {formatMetric(series, row.metric)}
            </p>
            {!row.isReference && (
                <p
                    className={
                        row.distinguishable ? 'text-theme-text' : 'text-theme-text-secondary'
                    }
                >
                    {row.distinguishable
                        ? 'Differs from the current value at this seed count'
                        : 'Not distinguishable from the current value at this seed count'}
                </p>
            )}
        </div>
    );
};

/**
 * A sweep as a curve of marked points.
 *
 * The connecting line is muted on purpose: it orders the points, it does not assert a trend. A
 * win-rate curve wobbling by a couple of wins is noise, and a line chart draws it as a trend
 * regardless — so the marker, not the line, is what the reader is meant to read.
 */
const StatSweepChart: React.FC<StatSweepChartProps> = ({
    points,
    series,
    statLabel,
    height = 320,
}) => {
    const rows = points.map((point) => toRow(point, series));
    const reference = rows.find((row) => row.isReference);
    const anyDistinguishable = rows.some((row) => !row.isReference && row.distinguishable);

    return (
        <div>
            <BaseChart height={height}>
                <LineChart data={rows} margin={LINE_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis
                        dataKey="value"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        // The swept values ARE the ticks. An auto tick set lands between steps,
                        // and a reader hunting a breakpoint cannot then tell which value a point
                        // sits at.
                        ticks={rows.map((row) => row.value)}
                        stroke="#9ca3af"
                        label={{ value: statLabel, position: 'insideBottom', offset: -8 }}
                    />
                    <YAxis
                        // Win rate is a proportion, so its axis is the whole 0-100% range. An
                        // auto domain zooms into whatever spread the run happened to produce,
                        // magnifying exactly the noise the paired test exists to discount.
                        domain={yAxisDomain(series)}
                        stroke="#9ca3af"
                        tickFormatter={(metric: number) => formatMetric(series, metric)}
                    />
                    <Tooltip
                        content={<SweepTooltip series={series} statLabel={statLabel} />}
                        cursor={{ stroke: MUTED_COLOR }}
                    />
                    {reference && (
                        <ReferenceLine
                            x={reference.value}
                            stroke="#ffffff"
                            strokeDasharray="4 4"
                            // Anchored inside the plot to the line's right: the default centres
                            // the label on the axis, where it lands on top of the y-axis ticks
                            // whenever the reference step is the leftmost one.
                            label={{
                                value: 'Current value',
                                fill: '#ffffff',
                                fontSize: 12,
                                position: 'insideTopRight',
                            }}
                        />
                    )}
                    <Line
                        {...chartLineDefaults(MUTED_COLOR)}
                        type="linear"
                        dataKey="metric"
                        name={SERIES_LABELS[series]}
                        stroke={MUTED_COLOR}
                        strokeWidth={1}
                        dot={renderSweepDot}
                    />
                </LineChart>
            </BaseChart>
            <ChartLegend
                items={[
                    { label: 'Current value', color: '#ffffff' },
                    { label: 'Differs from current at this seed count', color: SERIES_COLOR },
                    { label: 'Not distinguishable at this seed count', color: MUTED_COLOR },
                ]}
            />
            {!anyDistinguishable && (
                <p className="mt-2 text-sm text-theme-text-secondary text-center">
                    No step is distinguishable from the current value at this seed count — this stat
                    does not move the fight here.
                </p>
            )}
        </div>
    );
};

export default StatSweepChart;
