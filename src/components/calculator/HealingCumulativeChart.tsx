import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
    BaseChart,
    ChartLegend,
    ChartTooltip,
    CHART_LINE_COLORS,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { HealingSimulationResult } from '../../utils/calculators/healingEngineAdapter';

interface HealerSimResult {
    id: string;
    name: string;
    result: HealingSimulationResult;
}

interface HealingCumulativeChartProps {
    healers: HealerSimResult[];
    rounds: number;
    height?: number;
}

interface ChartDataPoint {
    round: number;
    [key: string]: number;
}

/** Cumulative EFFECTIVE healing comparison across configs (one line per healer). */
export const HealingCumulativeChart: React.FC<HealingCumulativeChartProps> = ({
    healers,
    rounds,
    height = 400,
}) => {
    const colors = useThemeColors();
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

    const nameById = new Map(healers.map((h) => [h.id, h.name]));

    return (
        <div>
            <BaseChart height={height}>
                <LineChart data={chartData} margin={LINE_CHART_MARGIN}>
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
                    <Tooltip
                        content={
                            <ChartTooltip
                                labelFormatter={(label) => `Round ${label}`}
                                formatter={(value, name) =>
                                    `${nameById.get(name) ?? name}: ${Number(value).toLocaleString()}`
                                }
                            />
                        }
                    />
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
    );
};
