import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
    BaseChart,
    ChartLegend,
    CHART_LINE_COLORS,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { HealingSimulationResult } from '../../utils/calculators/healingSimulator';

interface HealerSimEntry {
    id: string;
    name: string;
    result: HealingSimulationResult;
}

interface HealingRoundChartProps {
    healers: HealerSimEntry[];
    rounds: number;
    height?: number;
}

interface TooltipProps {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
    label?: number;
    healerMap: Map<string, HealerSimEntry>;
}

const RoundTooltip: React.FC<TooltipProps> = ({ active, payload, label, healerMap }) => {
    if (!active || !payload || !label) return null;

    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm">
            <p className="font-bold mb-1">Round {label}</p>
            {payload.map((entry) => {
                const healer = healerMap.get(entry.dataKey);
                const roundData = healer?.result.rounds[label - 1];
                return (
                    <div key={entry.dataKey} className="mb-1">
                        <p style={{ color: entry.color }} className="font-medium">
                            {entry.name}: {entry.value.toLocaleString()} HP
                        </p>
                        {roundData && (
                            <div className="text-xs text-theme-text-secondary pl-2">
                                <span
                                    className={
                                        roundData.action === 'charged'
                                            ? 'text-purple-400'
                                            : 'text-orange-400'
                                    }
                                >
                                    {roundData.action === 'charged' ? 'Charged' : 'Active'}:{' '}
                                    {roundData.healing.toLocaleString()} HP
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export const HealingRoundChart: React.FC<HealingRoundChartProps> = ({
    healers,
    rounds,
    height = 400,
}) => {
    const colors = useThemeColors();

    if (healers.length === 0) return null;

    const chartData = Array.from({ length: rounds }, (_, i) => {
        const point: Record<string, number> = { round: i + 1 };
        healers.forEach((h) => {
            point[h.id] = h.result.rounds[i]?.cumulativeHealing ?? 0;
        });
        return point;
    });

    const healerMap = new Map(healers.map((h) => [h.id, h]));

    return (
        <>
            <BaseChart height={height}>
                <LineChart data={chartData} margin={LINE_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.gridStroke} />
                    <XAxis
                        dataKey="round"
                        tick={{ fill: colors.text }}
                        label={{
                            value: 'Round',
                            position: 'insideBottom',
                            offset: -10,
                            fill: colors.text,
                        }}
                    />
                    <YAxis
                        tick={{ fill: colors.text }}
                        tickFormatter={(v) =>
                            v >= 1000000
                                ? `${(v / 1000000).toFixed(1)}M`
                                : v >= 1000
                                  ? `${(v / 1000).toFixed(0)}k`
                                  : String(v)
                        }
                        label={{
                            value: 'Cumulative Healing (HP)',
                            angle: -90,
                            position: 'insideLeft',
                            offset: 10,
                            fill: colors.text,
                        }}
                    />
                    <Tooltip content={<RoundTooltip healerMap={healerMap} />} />
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
        </>
    );
};
