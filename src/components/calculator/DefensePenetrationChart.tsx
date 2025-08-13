import React, { useMemo } from 'react';
import {
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ComposedChart,
} from 'recharts';
import { calculateDamageReduction } from '../../utils/autogear/scoring';

interface DefensePenetrationChartProps {
    height?: number;
    defenseValues?: number[];
    penetrationValues?: number[];
}

const ErrorFallback = () => (
    <div className="bg-dark p-4 border border-red-500 rounded">
        <h3 className="text-lg font-bold text-red-500 mb-2">Chart Error</h3>
        <p className="mb-2">There was an error rendering the defense penetration chart.</p>
    </div>
);

export const DefensePenetrationChart: React.FC<DefensePenetrationChartProps> = ({
    height = 400,
    defenseValues = [2500, 5000, 10000, 12000, 15000, 20000],
    penetrationValues = [0, 7, 14, 21, 28, 35, 42, 45, 49, 52, 56, 59, 63, 66],
}) => {
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
        return <ErrorFallback />;
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
                <div className="bg-dark-lighter p-3 border border-dark-border text-white rounded">
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
                                    <div className="text-xs text-gray-400">
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

    // Colors for different defense values
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6'];

    return (
        <div className="defense-penetration-chart">
            <h2 className="text-xl font-bold mb-4">Damage Increase by Defense Penetration</h2>
            <div style={{ width: '100%', height }}>
                <ResponsiveContainer>
                    <ComposedChart
                        data={chartData}
                        margin={{ top: 5, right: 30, left: 20, bottom: 12 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                        <XAxis
                            dataKey="penetration"
                            name="Defense Penetration"
                            domain={[0, 66]}
                            tick={{ fill: '#fff' }}
                            label={{
                                value: 'Defense Penetration (%)',
                                position: 'insideBottom',
                                offset: -10,
                                fill: '#fff',
                            }}
                            type="number"
                        />
                        <YAxis
                            domain={[0, 200]}
                            tick={{ fill: '#fff' }}
                            label={{
                                value: 'Damage Increase (%)',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#fff',
                            }}
                            type="number"
                        />
                        <Tooltip content={<CustomTooltip />} />

                        {/* Lines for each defense value */}
                        {defenseValues.map((defense, index) => (
                            <Line
                                key={defense}
                                type="monotone"
                                dataKey={`defense_${defense}`}
                                stroke={colors[index % colors.length]}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{
                                    r: 6,
                                    stroke: colors[index % colors.length],
                                    strokeWidth: 2,
                                }}
                                name={`${(defense / 1000).toFixed(0)}k Defense`}
                            />
                        ))}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-4 mt-6">
                {defenseValues.map((defense, index) => (
                    <div key={defense} className="flex items-center gap-2">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: colors[index % colors.length] }}
                        />
                        <span className="text-sm text-white">
                            {(defense / 1000).toFixed(0)}k Defense
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};
