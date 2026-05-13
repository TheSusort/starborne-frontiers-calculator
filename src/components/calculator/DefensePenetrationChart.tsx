import React, { useMemo } from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart } from 'recharts';
import { calculateDamageReduction } from '../../utils/autogear/scoring';
import {
    BaseChart,
    ChartLegend,
    DefaultErrorFallback,
    CHART_LINE_COLORS,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';

interface DefensePenetrationChartProps {
    height?: number;
    defenseValues?: number[];
    penetrationValues?: number[];
}

export const DefensePenetrationChart: React.FC<DefensePenetrationChartProps> = ({
    height = 400,
    defenseValues = [2500, 5000, 10000, 12000, 15000, 20000],
    penetrationValues = [0, 7, 14, 21, 28, 35, 42, 45, 49, 52, 56, 59, 63, 66],
}) => {
    const themeColors = useThemeColors();

    // Generate data for each defense value
    const chartData = useMemo(() => {
        try {
            const data = [];

            // Create data points for each penetration value
            for (const penetration of penetrationValues) {
                const dataPoint: { penetration: number } & Record<string, number> = {
                    penetration,
                };

                // Calculate damage increase for each defense value
                defenseValues.forEach((defense) => {
                    const originalDefense = defense;
                    const originalReduction = calculateDamageReduction(originalDefense);
                    const originalDamage = 100 - originalReduction; // Damage dealt at 0% penetration

                    const effectiveDefense = defense * (1 - penetration / 100);
                    const currentReduction = calculateDamageReduction(effectiveDefense);
                    const currentDamage = 100 - currentReduction; // Damage dealt at current penetration

                    // Calculate damage increase as percentage
                    const damageIncrease =
                        ((currentDamage - originalDamage) / originalDamage) * 100;
                    dataPoint[`defense_${defense}`] = damageIncrease;
                });

                data.push(dataPoint);
            }

            return data;
        } catch (error) {
            console.error('Error generating defense penetration data:', error);
            return [];
        }
    }, [defenseValues, penetrationValues]);

    // If no data or error, show fallback
    if (chartData.length === 0) {
        return (
            <DefaultErrorFallback
                title="Chart Error"
                message="There was an error rendering the defense penetration chart."
            />
        );
    }

    // Custom tooltip component
    interface TooltipProps {
        active?: boolean;
        payload?: Array<{
            payload: {
                penetration: number;
                [key: string]: number;
            };
            dataKey: string;
            value: number;
            color: string;
        }>;
    }

    const CustomTooltip = ({ active, payload }: TooltipProps) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;

            return (
                <div className="bg-dark-lighter p-3 border border-dark-border text-white">
                    <p className="font-bold mb-2">Defense Penetration: {data.penetration}%</p>
                    {payload.map((entry, index) => {
                        if (entry.dataKey === 'penetration') return null;

                        const defenseValue = entry.dataKey.replace('defense_', '');
                        const damageIncrease = entry.value;

                        // Calculate the original damage reduction (0% penetration)
                        const originalDefense = parseInt(defenseValue);
                        const originalReduction = calculateDamageReduction(originalDefense);
                        const originalDamage = 100 - originalReduction;

                        // Calculate current damage at this penetration
                        const currentDamage = originalDamage * (1 + damageIncrease / 100);

                        return (
                            <div key={index} className="flex items-center gap-2 mb-1">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: entry.color }}
                                />
                                <div className="text-sm">
                                    <div>
                                        {(parseInt(defenseValue) / 1000).toFixed(0)}k Def: +
                                        {damageIncrease.toFixed(1)}% damage
                                    </div>
                                    <div className="text-xs text-theme-text-secondary">
                                        {originalDamage.toFixed(1)}% → {currentDamage.toFixed(1)}%
                                        damage dealt
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="defense-penetration-chart">
            <h2 className="text-xl font-bold mb-4">Damage Increase by Defense Penetration</h2>
            <BaseChart
                height={height}
                error={chartData.length === 0 ? new Error('No data') : null}
                errorFallback={
                    <DefaultErrorFallback
                        title="Chart Error"
                        message="There was an error rendering the defense penetration chart."
                    />
                }
            >
                <ComposedChart data={chartData} margin={LINE_CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke={themeColors.gridStroke} />
                    <XAxis
                        dataKey="penetration"
                        name="Defense Penetration"
                        domain={[0, 66]}
                        tick={{ fill: themeColors.text }}
                        label={{
                            value: 'Defense Penetration (%)',
                            position: 'insideBottom',
                            offset: -10,
                            fill: themeColors.text,
                        }}
                        type="number"
                    />
                    <YAxis
                        domain={[0, 200]}
                        tick={{ fill: themeColors.text }}
                        label={{
                            value: 'Damage Increase (%)',
                            angle: -90,
                            position: 'insideLeft',
                            fill: themeColors.text,
                        }}
                        type="number"
                    />
                    <Tooltip content={<CustomTooltip />} />
                    {defenseValues.map((defense, index) => {
                        const color = CHART_LINE_COLORS[index % CHART_LINE_COLORS.length];
                        return (
                            <Line
                                key={defense}
                                type="monotone"
                                dataKey={`defense_${defense}`}
                                stroke={color}
                                {...chartLineDefaults(color)}
                                name={`${(defense / 1000).toFixed(0)}k Defense`}
                            />
                        );
                    })}
                </ComposedChart>
            </BaseChart>
            <ChartLegend
                items={defenseValues.map((defense, index) => ({
                    label: `${(defense / 1000).toFixed(0)}k Defense`,
                    color: CHART_LINE_COLORS[index % CHART_LINE_COLORS.length],
                }))}
            />
        </div>
    );
};
