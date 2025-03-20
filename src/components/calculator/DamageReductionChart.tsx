import React, { useMemo } from 'react';
import {
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ComposedChart,
    Scatter,
    LabelList,
} from 'recharts';
import { calculateDamageReduction } from '../../utils/autogear/scoring';

interface Ship {
    id: string;
    name: string;
    defense: number;
    damageReduction: number;
    isHighlighted?: boolean;
}

interface DamageReductionChartProps {
    ships: Ship[];
    height?: number;
    maxDefense?: number;
}

const ErrorFallback = () => (
    <div className="bg-dark p-4 border border-red-500 rounded">
        <h3 className="text-lg font-bold text-red-500 mb-2">Chart Error</h3>
        <p className="mb-2">There was an error rendering the damage reduction chart.</p>
        <p>You can still view and compare your ship configurations using the data cards above.</p>
    </div>
);

export const DamageReductionChart: React.FC<DamageReductionChartProps> = ({
    ships = [],
    height = 400,
    maxDefense = 26000,
}) => {
    // Generate data for the curve
    const curveData = useMemo(() => {
        try {
            const data = [];
            const step = maxDefense / 100;

            for (let defense = 0; defense <= maxDefense; defense += step) {
                data.push({
                    defense,
                    reduction: calculateDamageReduction(defense),
                });
            }
            return data;
        } catch (error) {
            console.error('Error generating damage reduction data:', error);
            return [];
        }
    }, [maxDefense]);

    // Separate ship data into regular and highlighted ships with x/y formatting
    const regularShips = useMemo(() => {
        return ships
            .filter((ship) => !ship.isHighlighted)
            .map((ship) => ({
                defense: ship.defense,
                reduction: ship.damageReduction,
                name: ship.name,
            }));
    }, [ships]);

    const highlightedShips = useMemo(() => {
        return ships
            .filter((ship) => ship.isHighlighted)
            .map((ship) => ({
                defense: ship.defense,
                reduction: ship.damageReduction,
                name: ship.name,
            }));
    }, [ships]);

    // If no data or error, show fallback
    if (curveData.length === 0) {
        return <ErrorFallback />;
    }

    // Custom tooltip component
    interface TooltipProps {
        active?: boolean;
        payload?: Array<{
            payload: {
                defense: number;
                reduction: number;
                name?: string;
            };
        }>;
    }

    const CustomTooltip = ({ active, payload }: TooltipProps) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;

            if (data.name) {
                // Ship point tooltip
                return (
                    <div className="bg-dark-lighter p-2 border border-dark-border text-white">
                        <p className="font-bold">{data.name}</p>
                        <p>Defense: {data.defense ? data.defense.toLocaleString() : 'N/A'}</p>
                        <p>
                            Damage Reduction: {data.reduction ? data.reduction.toFixed(2) : 'N/A'}%
                        </p>
                    </div>
                );
            } else {
                // Regular curve point
                return (
                    <div className="bg-dark-lighter p-2 border border-dark-border text-white">
                        <p>Defense: {data.defense.toLocaleString()}</p>
                        <p>Damage Reduction: {data.reduction.toFixed(2)}%</p>
                    </div>
                );
            }
        }
        return null;
    };

    return (
        <div className="damage-reduction-chart">
            <h2 className="text-xl font-bold mb-4">Damage Reduction Curve</h2>
            <div style={{ width: '100%', height }}>
                <ResponsiveContainer>
                    <ComposedChart margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                        <XAxis
                            dataKey="defense"
                            name="Defense"
                            domain={[0, maxDefense]}
                            tick={{ fill: '#fff' }}
                            label={{
                                value: 'Defense',
                                position: 'insideBottomRight',
                                offset: -10,
                                fill: '#fff',
                            }}
                            type="number"
                            allowDataOverflow={true}
                        />
                        <YAxis
                            dataKey="reduction"
                            name="Damage Reduction"
                            domain={[0, 100]}
                            tick={{ fill: '#fff' }}
                            label={{
                                value: 'Damage Reduction (%)',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#fff',
                            }}
                            type="number"
                            allowDataOverflow={true}
                        />
                        <Tooltip content={<CustomTooltip />} />

                        {/* The damage reduction curve */}
                        <Line
                            data={curveData}
                            type="monotone"
                            dataKey="reduction"
                            stroke="#f97316"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 6 }}
                        />

                        {/* Regular ship points */}
                        <Scatter
                            data={regularShips}
                            fill="#94a3b8"
                            stroke="#fff"
                            strokeWidth={1}
                            name="Ships"
                        >
                            <LabelList dataKey="name" position="top" offset={10} width={100} />
                        </Scatter>

                        {/* Highlighted ship points */}
                        <Scatter
                            data={highlightedShips}
                            fill="#f97316"
                            stroke="#fff"
                            strokeWidth={1}
                            name="Best Ship"
                        >
                            <LabelList dataKey="name" position="top" offset={10} width={100} />
                        </Scatter>
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
