import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { HealerConfig, HealingBuffTotals } from '../../types/calculator';
import { calculateHealing } from '../../utils/calculators/healingCalculator';
import {
    BaseChart,
    ChartLegend,
    CHART_LINE_COLORS,
    ChartTooltip,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../ui/charts';
import { Select } from '../ui/Select';
import { useThemeColors } from '../../hooks/useThemeColors';

type ComparisonAxis = 'hp' | 'crit' | 'critDamage' | 'healModifier';

const COMPARISON_OPTIONS = [
    { value: 'hp', label: 'HP Impact' },
    { value: 'crit', label: 'Crit Chance Impact' },
    { value: 'critDamage', label: 'Crit Power Impact' },
    { value: 'healModifier', label: 'Heal Modifier Impact' },
];

const AXIS_LABELS: Record<ComparisonAxis, string> = {
    hp: 'HP',
    crit: 'Crit Chance (%)',
    critDamage: 'Crit Power (%)',
    healModifier: 'Heal Modifier (%)',
};

const AXIS_VALUES: Record<ComparisonAxis, number[]> = {
    hp: [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 110000, 120000],
    crit: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    critDamage: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200],
    healModifier: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
};

function generateComparisonData(
    configs: HealerConfig[],
    axis: ComparisonAxis,
    buffTotals?: Map<string, HealingBuffTotals>
): Record<string, number>[] {
    return AXIS_VALUES[axis].map((axisValue) => {
        const row: Record<string, number> = { [axis]: axisValue };
        configs.forEach((config) => {
            const tempConfig = { ...config, [axis]: axisValue };
            row[config.id] = calculateHealing(
                tempConfig,
                buffTotals?.get(config.id)
            ).effectiveHealing;
        });
        return row;
    });
}

interface HealingComparisonChartProps {
    configs: HealerConfig[];
    buffTotals?: Map<string, HealingBuffTotals>;
}

export const HealingComparisonChart: React.FC<HealingComparisonChartProps> = ({
    configs,
    buffTotals,
}) => {
    const [activeAxis, setActiveAxis] = useState<ComparisonAxis>('hp');
    const themeColors = useThemeColors();
    const data = generateComparisonData(configs, activeAxis, buffTotals);
    const axisLabel = AXIS_LABELS[activeAxis];

    return (
        <div className="card">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold w-full">Healing Comparison Chart</h2>
                <Select
                    value={activeAxis}
                    options={COMPARISON_OPTIONS}
                    onChange={(value) => setActiveAxis(value as ComparisonAxis)}
                    className="w-60"
                />
            </div>
            <p className="mb-4">
                This chart shows how changing {axisLabel} affects healing output, while keeping
                other values constant.
            </p>
            <BaseChart height={384}>
                <LineChart data={data} margin={LINE_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={themeColors.gridStroke} />
                    <XAxis
                        dataKey={activeAxis}
                        tick={{ fill: themeColors.text }}
                        tickFormatter={(v: number) =>
                            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                        }
                        label={{
                            value: axisLabel,
                            position: 'insideBottom',
                            offset: -10,
                            fill: themeColors.text,
                        }}
                    />
                    <YAxis
                        tick={{ fill: themeColors.text }}
                        tickFormatter={(v: number) =>
                            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                        }
                        label={{
                            value: 'Healing (HP)',
                            angle: -90,
                            position: 'insideLeft',
                            fill: themeColors.text,
                        }}
                    />
                    <Tooltip
                        content={
                            <ChartTooltip
                                formatter={(value: number | string) =>
                                    Math.round(Number(value)).toLocaleString()
                                }
                            />
                        }
                    />
                    {configs.map((config, i) => {
                        const color = CHART_LINE_COLORS[i % CHART_LINE_COLORS.length];
                        return (
                            <Line
                                key={config.id}
                                type="monotone"
                                dataKey={config.id}
                                name={config.name}
                                stroke={color}
                                {...chartLineDefaults(color)}
                            />
                        );
                    })}
                </LineChart>
            </BaseChart>
            <ChartLegend
                items={configs.map((config, i) => ({
                    label: config.name,
                    color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                }))}
            />
        </div>
    );
};
