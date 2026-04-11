import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { BaseChart } from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';

const LINE_COLORS = [
    '#ec8c37',
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ef4444',
    '#06b6d4',
    '#f97316',
];

interface ShipSimResult {
    id: string;
    name: string;
    result: DPSSimulationResult;
}

interface DPSRoundChartProps {
    ships: ShipSimResult[];
    rounds: number;
    height?: number;
}

interface ChartDataPoint {
    round: number;
    [key: string]: number;
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{
        name: string;
        value: number;
        color: string;
        dataKey: string;
    }>;
    label?: number;
    shipMap: Map<string, ShipSimResult>;
}

const RoundTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, shipMap }) => {
    if (!active || !payload || !label) return null;

    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm">
            <p className="font-bold mb-1">Round {label}</p>
            {payload.map((entry) => {
                const ship = shipMap.get(entry.dataKey);
                const roundData = ship?.result.rounds[label - 1];
                return (
                    <div key={entry.dataKey} className="mb-1">
                        <p style={{ color: entry.color }} className="font-medium">
                            {entry.name}: {entry.value.toLocaleString()}
                        </p>
                        {roundData && (
                            <div className="text-xs text-theme-text-secondary pl-2">
                                <span>Direct: {roundData.directDamage.toLocaleString()}</span>
                                {roundData.corrosionDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#6bcc6b' }}>
                                        Corr: {roundData.corrosionDamage.toLocaleString()}
                                    </span>
                                )}
                                {roundData.infernoDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#e67e22' }}>
                                        Inf: {roundData.infernoDamage.toLocaleString()}
                                    </span>
                                )}
                                {roundData.bombDamage > 0 && (
                                    <span className="ml-2" style={{ color: '#e74c3c' }}>
                                        Bomb: {roundData.bombDamage.toLocaleString()}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export const DPSRoundChart: React.FC<DPSRoundChartProps> = ({ ships, rounds, height = 400 }) => {
    const colors = useThemeColors();

    if (ships.length === 0) return null;

    const chartData: ChartDataPoint[] = [];
    for (let r = 1; r <= rounds; r++) {
        const point: ChartDataPoint = { round: r };
        ships.forEach((ship) => {
            const roundData = ship.result.rounds[r - 1];
            point[ship.id] = roundData ? roundData.cumulativeDamage : 0;
        });
        chartData.push(point);
    }

    const shipMap = new Map(ships.map((s) => [s.id, s]));

    return (
        <BaseChart height={height}>
            <LineChart data={chartData}>
                <XAxis
                    dataKey="round"
                    label={{
                        value: 'Round',
                        position: 'insideBottom',
                        offset: -5,
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
                        value: 'Cumulative Damage',
                        angle: -90,
                        position: 'insideLeft',
                        offset: 10,
                        fill: colors.text,
                    }}
                    tick={{ fill: colors.text }}
                />
                <Tooltip content={<RoundTooltip shipMap={shipMap} />} />
                <Legend />
                {ships.map((ship, i) => (
                    <Line
                        key={ship.id}
                        type="monotone"
                        dataKey={ship.id}
                        name={ship.name}
                        stroke={LINE_COLORS[i % LINE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                    />
                ))}
            </LineChart>
        </BaseChart>
    );
};
