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
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { DPSBuffPanel } from './DPSBuffPanel';

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

    const sorted = [...payload].sort((a, b) => b.value - a.value);

    return (
        <div className="bg-dark-lighter p-2 border border-dark-border text-white text-sm">
            <p className="font-bold mb-1">Round {label}</p>
            {sorted.map((entry) => {
                const ship = shipMap.get(entry.dataKey);
                const roundData = ship?.result.rounds[label - 1];
                return (
                    <div key={entry.dataKey} className="mb-1">
                        <p style={{ color: entry.color }} className="font-medium">
                            {entry.name}: {entry.value.toLocaleString()}
                            {roundData?.action === 'charged' && (
                                <span className="ml-1 text-yellow-400 text-xs">Charged</span>
                            )}
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
    const [hoveredRound, setHoveredRound] = useState<number | null>(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleMouseMove = (data: any) => {
        if (data?.activeLabel != null) setHoveredRound(Number(data.activeLabel));
    };
    const handleMouseLeave = () => setHoveredRound(null);

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
                                value: 'Cumulative Damage',
                                angle: -90,
                                position: 'insideLeft',
                                offset: 10,
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <Tooltip content={<RoundTooltip shipMap={shipMap} />} />
                        {ships.map((ship, i) => {
                            const color = CHART_LINE_COLORS[i % CHART_LINE_COLORS.length];
                            return (
                                <Line
                                    key={ship.id}
                                    type="monotone"
                                    dataKey={ship.id}
                                    name={ship.name}
                                    stroke={color}
                                    {...chartLineDefaults(color)}
                                />
                            );
                        })}
                    </LineChart>
                </BaseChart>
                <ChartLegend
                    items={ships.map((ship, i) => ({
                        label: ship.name,
                        color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                    }))}
                />
            </div>
            <DPSBuffPanel
                ships={ships
                    .map((s, i) => ({
                        name: s.name,
                        color: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                        totalDamage: s.result.summary.totalDamage,
                        roundData:
                            hoveredRound != null
                                ? (s.result.rounds[hoveredRound - 1] ?? null)
                                : null,
                    }))
                    .sort((a, b) => b.totalDamage - a.totalDamage)}
                totalRounds={rounds}
                hoveredRound={hoveredRound}
            />
        </div>
    );
};
