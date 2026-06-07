import React from 'react';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine,
} from 'recharts';
import { BaseChart, ChartLegend, LINE_CHART_MARGIN } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { HealingSimulationResult } from '../../utils/calculators/healingEngineAdapter';

interface HealingTimelineChartProps {
    /** The config whose timeline to render (typically the best config). */
    result: HealingSimulationResult;
    name: string;
    rounds: number;
    height?: number;
}

const COLOR_HP = '#34d399'; // emerald — target HP%
const COLOR_SHIELD = '#a78bfa'; // violet — shield pool
const COLOR_HEAL = '#60a5fa'; // blue — effective healing
const COLOR_DAMAGE = '#f87171'; // red — incoming damage

interface TimelineTooltipProps {
    active?: boolean;
    payload?: Array<{ dataKey: string; value: number }>;
    label?: number;
}

const fmtCompact = (v: number) =>
    v >= 1000000
        ? `${(v / 1000000).toFixed(1)}M`
        : v >= 1000
          ? `${(v / 1000).toFixed(0)}k`
          : `${v}`;

const TimelineTooltip: React.FC<TimelineTooltipProps> = ({ active, payload, label }) => {
    if (!active || !payload || !label) return null;
    const get = (key: string) => payload.find((p) => p.dataKey === key)?.value ?? 0;
    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm">
            <p className="font-bold mb-1">Round {label}</p>
            <p style={{ color: COLOR_HP }}>Target HP: {get('targetHpPct')}%</p>
            <p style={{ color: COLOR_SHIELD }}>
                Shield pool: {get('targetShieldPool').toLocaleString()}
            </p>
            <p style={{ color: COLOR_HEAL }}>
                Effective heal: {get('effectiveHealing').toLocaleString()}
            </p>
            <p style={{ color: COLOR_DAMAGE }}>
                Incoming damage: {get('incomingDamage').toLocaleString()}
            </p>
        </div>
    );
};

/**
 * Per-config healing timeline. HP% rides a right-hand 0-100 axis (line); incoming damage and
 * effective healing are bars on the left value axis; the shield pool is an overlaid line on
 * the value axis. Minimal, mirrors the DPSRoundChart tooltip conventions.
 */
export const HealingTimelineChart: React.FC<HealingTimelineChartProps> = ({
    result,
    name,
    rounds,
    height = 360,
}) => {
    const colors = useThemeColors();

    // The round the target was destroyed (if any) — marked with a danger ReferenceLine so the
    // round HP reaches 0 is obvious, mirroring the DPSRoundChart kill mark in intent and color.
    const destroyedRound = result.summary.destroyedRound;

    const data = [];
    for (let r = 1; r <= rounds; r++) {
        const rd = result.rounds[r - 1];
        data.push({
            round: r,
            targetHpPct: rd?.targetHpPct ?? 0,
            targetShieldPool: rd?.targetShieldPool ?? 0,
            effectiveHealing: rd?.effectiveHealing ?? 0,
            incomingDamage: rd?.incomingDamage ?? 0,
        });
    }

    return (
        <div>
            <p className="text-sm text-theme-text-secondary mb-2">
                {name} — target HP %, shield pool, and per-round healing vs incoming damage.
            </p>
            <BaseChart height={height}>
                <ComposedChart data={data} margin={LINE_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                    <XAxis
                        dataKey="round"
                        label={{
                            value: 'Round',
                            position: 'insideBottom',
                            offset: -10,
                            fill: colors.text,
                        }}
                        tick={{ fill: colors.text }}
                    />
                    <YAxis
                        yAxisId="value"
                        tickFormatter={fmtCompact}
                        tick={{ fill: colors.text }}
                        label={{
                            value: 'Healing / Damage',
                            angle: -90,
                            position: 'insideLeft',
                            offset: 10,
                            fill: colors.text,
                        }}
                    />
                    <YAxis
                        yAxisId="pct"
                        orientation="right"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fill: colors.text }}
                    />
                    <Tooltip content={<TimelineTooltip />} />
                    {destroyedRound !== undefined && (
                        <ReferenceLine
                            yAxisId="pct"
                            x={destroyedRound}
                            stroke={COLOR_DAMAGE}
                            strokeDasharray="4 3"
                            label={{
                                value: 'Destroyed',
                                position: 'top',
                                fill: COLOR_DAMAGE,
                                fontSize: 11,
                            }}
                        />
                    )}
                    <Bar
                        yAxisId="value"
                        dataKey="incomingDamage"
                        name="Incoming Damage"
                        fill={COLOR_DAMAGE}
                        opacity={0.6}
                    />
                    <Bar
                        yAxisId="value"
                        dataKey="effectiveHealing"
                        name="Effective Healing"
                        fill={COLOR_HEAL}
                        opacity={0.6}
                    />
                    <Line
                        yAxisId="value"
                        type="monotone"
                        dataKey="targetShieldPool"
                        name="Shield Pool"
                        stroke={COLOR_SHIELD}
                        dot={false}
                        strokeWidth={2}
                    />
                    <Line
                        yAxisId="pct"
                        type="monotone"
                        dataKey="targetHpPct"
                        name="Target HP %"
                        stroke={COLOR_HP}
                        dot={false}
                        strokeWidth={2}
                    />
                </ComposedChart>
            </BaseChart>
            <ChartLegend
                items={[
                    { label: 'Target HP %', color: COLOR_HP },
                    { label: 'Shield Pool', color: COLOR_SHIELD },
                    { label: 'Effective Healing', color: COLOR_HEAL },
                    { label: 'Incoming Damage', color: COLOR_DAMAGE },
                ]}
            />
        </div>
    );
};
