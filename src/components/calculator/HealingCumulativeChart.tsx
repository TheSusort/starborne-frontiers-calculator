import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
    BaseChart,
    ChartLegend,
    CHART_LINE_COLORS,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import {
    HealingSimulationResult,
    HealingRoundData,
} from '../../utils/calculators/healingEngineAdapter';
import { EnemyEffectsPanel } from './EnemyEffectsPanel';

interface HealerSimResult {
    id: string;
    name: string;
    result: HealingSimulationResult;
}

interface HealingCumulativeChartProps {
    healers: HealerSimResult[];
    rounds: number;
    /** Resolves an enemy attacker's id to its display name for the right-hand effects panel. */
    enemyName: (enemyId: string) => string;
    height?: number;
}

interface ChartDataPoint {
    round: number;
    [key: string]: number;
}

const COLOR_DIRECT = '#60a5fa'; // blue — direct heal
const COLOR_HOT = '#34d399'; // emerald — heal over time
const COLOR_SHIELD = '#a78bfa'; // violet — shield pool
const COLOR_OVERHEAL = '#9ca3af'; // grey — wasted overheal
const COLOR_DAMAGE = '#f87171'; // red — incoming damage

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

/** One config's per-round numbers inside the tooltip (mirrors DPSRoundChart's per-ship block). */
const ConfigBlock: React.FC<{ name: string; color: string; rd: HealingRoundData | undefined }> = ({
    name,
    color,
    rd,
}) => {
    if (!rd) return null;
    const isEmpty =
        rd.directHeal === 0 &&
        rd.hotHeal === 0 &&
        rd.shield === 0 &&
        rd.cleanseCount === 0 &&
        rd.incomingDamage === 0 &&
        (rd.teamHealing ?? 0) === 0;

    return (
        <div className="mb-1.5 last:mb-0">
            <div className="flex items-center gap-2 mb-1">
                <span className="font-medium" style={{ color }}>
                    {name}
                </span>
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

interface RoundTooltipProps {
    active?: boolean;
    label?: number;
    healers: HealerSimResult[];
}

/** Rich per-round tooltip listing EVERY config's numbers for the hovered round (mirrors the DPS
 *  RoundTooltip, which lists all ships' per-round values). */
const RoundTooltip: React.FC<RoundTooltipProps> = ({ active, label, healers }) => {
    if (!active || !label) return null;
    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm max-w-[280px]">
            <p className="font-bold mb-1.5">Round {label}</p>
            {healers.map((h, i) => (
                <ConfigBlock
                    key={h.id}
                    name={h.name}
                    color={CHART_LINE_COLORS[i % CHART_LINE_COLORS.length]}
                    rd={h.result.rounds[label - 1]}
                />
            ))}
        </div>
    );
};

/** Cumulative EFFECTIVE healing comparison across configs (one line per healer). Mirrors the DPS
 *  calculator's DPSRoundChart: a hover-driven rich tooltip surfaces every config's per-round
 *  numbers, and a right-hand hover-gated panel (EnemyEffectsPanel, mirroring DPSBuffPanel) shows
 *  the hovered round's per-config enemy effects. The hover state is internal and shared. */
export const HealingCumulativeChart: React.FC<HealingCumulativeChartProps> = ({
    healers,
    rounds,
    enemyName,
    height = 400,
}) => {
    const colors = useThemeColors();
    const [hoveredRound, setHoveredRound] = useState<number | null>(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMouseMove = (data: any) => {
        if (data?.activeLabel != null) setHoveredRound(Number(data.activeLabel));
    };
    const handleMouseLeave = () => setHoveredRound(null);

    if (healers.length === 0) return null;

    const running = new Map<string, number>();
    const chartData: ChartDataPoint[] = [];
    for (let r = 1; r <= rounds; r++) {
        const point: ChartDataPoint = { round: r };
        healers.forEach((h) => {
            const rd = h.result.rounds[r - 1];
            const next = (running.get(h.id) ?? 0) + (rd?.effectiveHealing ?? 0);
            running.set(h.id, next);
            point[h.id] = next;
        });
        chartData.push(point);
    }

    return (
        <div className="flex gap-4 items-start">
            <div className="flex-1 min-w-0">
                <BaseChart height={height}>
                    <LineChart
                        data={chartData}
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
                            tickFormatter={(v) =>
                                v >= 1000000
                                    ? `${(v / 1000000).toFixed(1)}M`
                                    : v >= 1000
                                      ? `${(v / 1000).toFixed(0)}k`
                                      : v.toString()
                            }
                            label={{
                                value: 'Cumulative Effective Healing',
                                angle: -90,
                                position: 'insideLeft',
                                offset: 10,
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <Tooltip content={<RoundTooltip healers={healers} />} />
                        {healers.map((h, i) => {
                            const color = CHART_LINE_COLORS[i % CHART_LINE_COLORS.length];
                            return (
                                <Line
                                    key={h.id}
                                    type="monotone"
                                    dataKey={h.id}
                                    name={h.name}
                                    stroke={color}
                                    {...chartLineDefaults(color)}
                                    dot={false}
                                />
                            );
                        })}
                    </LineChart>
                </BaseChart>
                <ChartLegend
                    items={healers.map((h, i) => ({
                        label: h.name,
                        color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                    }))}
                />
            </div>
            <EnemyEffectsPanel
                configs={healers.map((h, i) => ({
                    name: h.name,
                    color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                    roundData:
                        hoveredRound != null ? (h.result.rounds[hoveredRound - 1] ?? null) : null,
                }))}
                totalRounds={rounds}
                hoveredRound={hoveredRound}
                enemyName={enemyName}
            />
        </div>
    );
};
