import React, { useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { BaseChart, ChartLegend, LINE_CHART_MARGIN } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import {
    HealingSimulationResult,
    HealingRoundData,
} from '../../utils/calculators/healingEngineAdapter';
import { EnemyEffectsPanel } from './EnemyEffectsPanel';

interface HealingTimelineChartProps {
    /** The config whose timeline to render (typically the best config). */
    result: HealingSimulationResult;
    name: string;
    rounds: number;
    /** Resolves an enemy attacker's id to its display name for the right-hand effects panel. */
    enemyName: (enemyId: string) => string;
    height?: number;
}

const COLOR_HP = '#34d399'; // emerald — target HP%
const COLOR_SHIELD = '#a78bfa'; // violet — shield pool
const COLOR_HEAL = '#60a5fa'; // blue — effective healing
const COLOR_DAMAGE = '#f87171'; // red — incoming damage

const COLOR_DIRECT = '#60a5fa'; // blue — direct heal
const COLOR_HOT = '#34d399'; // emerald — heal over time
const COLOR_OVERHEAL = '#9ca3af'; // grey — wasted overheal

/** A single labelled metric chip inside the tooltip. */
const Metric: React.FC<{ label: string; value: string; color?: string }> = ({
    label,
    value,
    color,
}) => (
    <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-theme-text-secondary">
            {label}
        </span>
        <span className="text-xs font-medium" style={color ? { color } : undefined}>
            {value}
        </span>
    </div>
);

interface TimelineTooltipProps {
    active?: boolean;
    label?: number;
    /** The simulation result so the tooltip can surface the full per-round healer numbers. */
    result: HealingSimulationResult;
}

const TimelineTooltip: React.FC<TimelineTooltipProps> = ({ active, label, result }) => {
    if (!active || !label) return null;
    const rd: HealingRoundData | undefined = result.rounds[label - 1];
    if (!rd) return null;

    const isEmpty =
        rd.directHeal === 0 &&
        rd.hotHeal === 0 &&
        rd.shield === 0 &&
        rd.cleanseCount === 0 &&
        rd.incomingDamage === 0 &&
        (rd.teamHealing ?? 0) === 0;

    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm max-w-[220px]">
            <div className="flex items-center gap-2 mb-1.5">
                <span className="font-bold">Round {rd.round}</span>
                {rd.action === 'charged' && (
                    <span className="text-[10px] text-yellow-400 uppercase tracking-wide">
                        Charged
                    </span>
                )}
                {rd.didCrit && (
                    <span className="text-[10px] text-red-400 uppercase tracking-wide">Crit</span>
                )}
                <span className="ml-auto text-[10px] text-theme-text-secondary">
                    Target HP {rd.targetHpPct}%
                </span>
            </div>
            {isEmpty ? (
                <p className="text-xs text-dark-border italic">No healer output this round</p>
            ) : (
                <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                    {rd.directHeal > 0 && (
                        <Metric
                            label="Direct"
                            value={rd.directHeal.toLocaleString()}
                            color={COLOR_DIRECT}
                        />
                    )}
                    {rd.hotHeal > 0 && (
                        <Metric label="HoT" value={rd.hotHeal.toLocaleString()} color={COLOR_HOT} />
                    )}
                    {rd.shield > 0 && (
                        <Metric
                            label="Shield"
                            value={rd.shield.toLocaleString()}
                            color={COLOR_SHIELD}
                        />
                    )}
                    {rd.effectiveHealing > 0 && (
                        <Metric label="Effective" value={rd.effectiveHealing.toLocaleString()} />
                    )}
                    {rd.overheal > 0 && (
                        <Metric
                            label="Overheal"
                            value={rd.overheal.toLocaleString()}
                            color={COLOR_OVERHEAL}
                        />
                    )}
                    {rd.cleanseCount > 0 && (
                        <Metric label="Cleanses" value={`${rd.cleanseCount}`} />
                    )}
                    {rd.incomingDamage > 0 && (
                        <Metric
                            label="Incoming"
                            value={rd.incomingDamage.toLocaleString()}
                            color={COLOR_DAMAGE}
                        />
                    )}
                    {(rd.teamHealing ?? 0) > 0 && (
                        <Metric label="Team Heal" value={(rd.teamHealing ?? 0).toLocaleString()} />
                    )}
                </div>
            )}
        </div>
    );
};

const fmtCompact = (v: number) =>
    v >= 1000000
        ? `${(v / 1000000).toFixed(1)}M`
        : v >= 1000
          ? `${(v / 1000).toFixed(0)}k`
          : `${v}`;

/**
 * Per-config healing timeline. HP% rides a right-hand 0-100 axis (line); incoming damage and
 * effective healing are bars on the left value axis; the shield pool is an overlaid line on the
 * value axis. Mirrors the DPS calculator's DPSRoundChart pattern exactly: the chart's hover
 * tooltip surfaces the full per-round HEALER NUMBERS, and a right-hand hover-gated panel
 * (EnemyEffectsPanel, mirroring DPSBuffPanel) shows the hovered round's per-enemy effects.
 * The hover state is internal to the chart and shared with the right panel.
 */
export const HealingTimelineChart: React.FC<HealingTimelineChartProps> = ({
    result,
    name,
    rounds,
    enemyName,
    height = 360,
}) => {
    const colors = useThemeColors();
    const [hoveredRound, setHoveredRound] = useState<number | null>(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMouseMove = (data: any) => {
        if (data?.activeLabel != null) setHoveredRound(Number(data.activeLabel));
    };
    const handleMouseLeave = () => setHoveredRound(null);

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
        <div className="flex gap-4 items-start">
            <div className="flex-1 min-w-0">
                <p className="text-sm text-theme-text-secondary mb-2">
                    {name} — target HP %, shield pool, and per-round healing vs incoming damage.
                </p>
                <BaseChart height={height}>
                    <ComposedChart
                        data={data}
                        margin={LINE_CHART_MARGIN}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
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
                        <Tooltip content={<TimelineTooltip result={result} />} />
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
            <EnemyEffectsPanel
                roundData={hoveredRound != null ? (result.rounds[hoveredRound - 1] ?? null) : null}
                totalRounds={rounds}
                hoveredRound={hoveredRound}
                enemyName={enemyName}
            />
        </div>
    );
};
