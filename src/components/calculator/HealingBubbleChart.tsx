import React from 'react';
import {
    ScatterChart,
    Scatter,
    XAxis,
    YAxis,
    ZAxis,
    CartesianGrid,
    Tooltip,
    LabelList,
} from 'recharts';
import { HealerConfig, HealingBuffTotals } from '../../types/calculator';
import { calculateHealing } from '../../utils/calculators/healingCalculator';
import {
    BaseChart,
    ChartLegend,
    ChartTooltip,
    CHART_LINE_COLORS,
    LINE_CHART_MARGIN,
} from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';

interface HealingBubbleChartProps {
    configs: HealerConfig[];
    buffTotals?: Map<string, HealingBuffTotals>;
}

export const HealingBubbleChart: React.FC<HealingBubbleChartProps> = ({ configs, buffTotals }) => {
    const themeColors = useThemeColors();

    const series = configs.map((config, i) => ({
        config,
        point: {
            name: config.name,
            hp: config.hp,
            crit: config.crit,
            healing: calculateHealing(config, buffTotals?.get(config.id)).effectiveHealing,
        },
        color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
    }));

    return (
        <div className="card">
            <h2 className="text-xl font-bold mb-2">3D Relationship Visualization</h2>
            <p className="mb-4">
                This chart visualizes the relationship between HP (x-axis), Crit Chance (y-axis),
                and healing amount (bubble size). Each bubble represents a healer configuration.
            </p>
            <BaseChart height={384}>
                <ScatterChart margin={LINE_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={themeColors.gridStroke} />
                    <XAxis
                        type="number"
                        dataKey="hp"
                        name="HP"
                        tick={{ fill: themeColors.text }}
                        tickFormatter={(v: number) =>
                            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                        }
                        label={{
                            value: 'HP',
                            position: 'insideBottom',
                            offset: -10,
                            fill: themeColors.text,
                        }}
                    />
                    <YAxis
                        type="number"
                        dataKey="crit"
                        name="Crit Chance"
                        tick={{ fill: themeColors.text }}
                        label={{
                            value: 'Crit Chance (%)',
                            angle: -90,
                            position: 'insideLeft',
                            fill: themeColors.text,
                        }}
                    />
                    <ZAxis type="number" dataKey="healing" range={[100, 1000]} name="Healing" />
                    <Tooltip
                        content={
                            <ChartTooltip
                                formatter={(value: number | string, name: string) => {
                                    if (name === 'Healing') {
                                        return `${Math.round(Number(value)).toLocaleString()} HP`;
                                    }
                                    return String(value);
                                }}
                            />
                        }
                        cursor={{ strokeDasharray: '3 3' }}
                    />
                    {series.map(({ config, point, color }) => (
                        <Scatter key={config.id} name={point.name} data={[point]} fill={color}>
                            <LabelList
                                dataKey="name"
                                position="top"
                                style={{ fill: color, fontSize: 12 }}
                            />
                        </Scatter>
                    ))}
                </ScatterChart>
            </BaseChart>
            <ChartLegend items={series.map(({ point, color }) => ({ label: point.name, color }))} />
        </div>
    );
};
