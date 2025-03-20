import React, { useMemo, useRef } from 'react';
import {
    ScatterChart,
    Scatter,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Legend,
    LabelList,
} from 'recharts';
import { calculateCritMultiplier } from '../../utils/autogear/scoring';
import { BaseStats } from '../../types/stats';

interface ShipConfig {
    id: string;
    name: string;
    attack: number;
    critRate: number;
    critDamage: number;
    isBest?: boolean;
}

interface DPSChartProps {
    ships: ShipConfig[];
    height?: number;
}

// DPS heatmap data point
interface HeatmapPoint {
    x: number; // crit damage
    y: number; // attack
    z: number; // DPS
    fill: string; // Color for the point
}

const ErrorFallback = () => (
    <div className="bg-dark p-4 border border-red-500 rounded">
        <h3 className="text-lg font-bold text-red-500 mb-2">Chart Error</h3>
        <p className="mb-2">There was an error rendering the DPS Analysis chart.</p>
        <p>You can still view and compare your ship configurations using the data cards above.</p>
    </div>
);

// Custom tooltip component
interface TooltipProps {
    active?: boolean;
    payload?: Array<{
        payload: {
            x: number;
            y: number;
            z: number;
            fill?: string;
            name?: string;
            isShipPoint?: boolean;
            isBest?: boolean;
        };
    }>;
}

const CustomTooltip = ({ active, payload }: TooltipProps) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;

        if (data.isShipPoint) {
            // Ship point tooltip
            return (
                <div className="bg-dark-lighter p-2 border border-dark-border text-white">
                    <p className="text-xs text-gray-400">{data.isBest ? 'Best DPS' : ''}</p>
                    <p className="font-bold">{data.name}</p>
                    <p>Attack: {(data.y / 1000).toFixed(1)}k</p>
                    <p>Crit Damage: {data.x.toFixed(0)}%</p>
                    <p>DPS: {(data.z / 1000).toFixed(1)}k</p>
                </div>
            );
        } else {
            // DPS heatmap tooltip
            return (
                <div className="bg-dark-lighter p-2 border border-dark-border text-white">
                    <p>Crit Damage: {data.x.toFixed(0)}%</p>
                    <p>Attack: {(data.y / 1000).toFixed(1)}k</p>
                    <p>DPS: {(data.z / 1000).toFixed(1)}k</p>
                </div>
            );
        }
    }
    return null;
};

// Generate color for DPS value
const getDPSColor = (dps: number, maxDps: number): string => {
    // Use a gradient from blue (low) to orange/red (high)
    const ratio = dps / maxDps;

    // Use HSL for smoother transitions
    if (ratio < 0.2) {
        return '#00008B'; // Dark blue
    } else if (ratio < 0.4) {
        return '#0000CD'; // Medium blue
    } else if (ratio < 0.6) {
        return '#1E90FF'; // Dodger blue
    } else if (ratio < 0.8) {
        return '#00BFFF'; // Deep sky blue
    } else if (ratio < 1.0) {
        return '#87CEEB'; // Sky blue
    } else if (ratio < 1.25) {
        return '#FFD700'; // Gold
    } else if (ratio < 1.5) {
        return '#FFA500'; // Orange
    } else {
        return '#FF4500'; // Orange red
    }
};

// Define interfaces for the custom shape props
interface CustomShapeProps {
    cx: number;
    cy: number;
    fill?: string;
    payload?: {
        x: number;
        y: number;
        z: number;
        isShipPoint?: boolean;
        isBest?: boolean;
        name?: string;
    };
}

// Custom shape for scatter points (rectangles for heatmap)
const CustomHeatmapRect = (props: CustomShapeProps) => {
    const { cx, cy, fill } = props;
    // Use a slightly larger rectangle to ensure no gaps between cells
    const size = 10;

    return <rect x={cx} y={cy - size} width={26} height={size} fill={fill} stroke="none" />;
};

// Custom shape for ship points (stars)
const CustomShipShape = (props: CustomShapeProps) => {
    const { cx, cy, payload } = props;

    if (!payload) return null;

    const size = payload.isBest ? 12 : 6; // Size of the star
    const starColor = payload.isBest ? '#000' : '#c2c2c2';

    // Create a 5-pointed star shape
    const points = [
        [cx, cy - size],
        [cx + size * 0.3, cy - size * 0.3],
        [cx + size, cy],
        [cx + size * 0.3, cy + size * 0.3],
        [cx, cy + size],
        [cx - size * 0.3, cy + size * 0.3],
        [cx - size, cy],
        [cx - size * 0.3, cy - size * 0.3],
        [cx, cy - size],
    ]
        .map((point) => point.join(','))
        .join(' ');

    return <path d={`M ${points}`} fill={starColor} stroke="#fff" strokeWidth={1} />;
};

// Generate legend items for DPS values
const getLegendData = () => {
    return [
        { value: '< 20% max DPS', color: '#00008B', type: 'rect' as const, id: 'legend-1' },
        { value: '20-40% max DPS', color: '#0000CD', type: 'rect' as const, id: 'legend-2' },
        { value: '40-60% max DPS', color: '#1E90FF', type: 'rect' as const, id: 'legend-3' },
        { value: '60-80% max DPS', color: '#00BFFF', type: 'rect' as const, id: 'legend-4' },
        { value: '80-100% max DPS', color: '#87CEEB', type: 'rect' as const, id: 'legend-5' },
        { value: '100-125% max DPS', color: '#FFD700', type: 'rect' as const, id: 'legend-6' },
        { value: '125-150% max DPS', color: '#FFA500', type: 'rect' as const, id: 'legend-7' },
        { value: '> 150% max DPS', color: '#FF4500', type: 'rect' as const, id: 'legend-8' },
    ];
};

// Custom legend to show DPS value ranges
const CustomLegend = () => {
    return (
        <div className="custom-legend flex flex-wrap justify-center mt-4 gap-2 bg-dark-lighter p-2 rounded">
            {getLegendData().map((item) => (
                <div key={item.id} className="flex items-center mr-4">
                    <div className="w-3 h-3 mr-1" style={{ backgroundColor: item.color }} />
                    <span className="text-xs text-white">{item.value}</span>
                </div>
            ))}
        </div>
    );
};

// Define a type for the shape callback props
interface ShapeCallbackProps {
    cx?: number;
    cy?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    name?: string;
    payload?: {
        x: number;
        y: number;
        z: number;
        fill?: string;
        name?: string;
        isShipPoint?: boolean;
        isBest?: boolean;
    };
}

export const DPSChart: React.FC<DPSChartProps> = ({ ships = [], height = 500 }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);

    // Calculate DPS for ships and find max DPS
    const { shipPoints, maxDps } = useMemo(() => {
        try {
            if (ships.length === 0) {
                return { shipPoints: [], maxDps: 0 };
            }

            const points = ships.map((ship) => {
                const stats: BaseStats = {
                    attack: ship.attack,
                    crit: ship.critRate,
                    critDamage: ship.critDamage,
                    hp: 0,
                    defence: 0,
                    hacking: 0,
                    security: 0,
                    speed: 0,
                    healModifier: 0,
                };
                const critMultiplier = calculateCritMultiplier(stats);
                const dps = ship.attack * critMultiplier;

                return {
                    id: ship.id,
                    name: ship.name,
                    x: ship.critDamage,
                    y: ship.attack,
                    z: dps,
                    isBest: ship.isBest,
                    isShipPoint: true,
                };
            });

            const maxDpsValue = Math.max(...points.map((p) => p.z));
            return { shipPoints: points, maxDps: maxDpsValue };
        } catch (error) {
            console.error('Error generating DPS chart data:', error);
            return { shipPoints: [], maxDps: 0 };
        }
    }, [ships]);

    // Generate heatmap data
    const heatmapData = useMemo(() => {
        if (maxDps === 0 || shipPoints.length === 0) return [];

        const critDamageRange = { min: 0, max: 275 };
        const attackRange = { min: 0, max: 30000 };

        // Even finer resolution for complete coverage
        const critDamageStep = 6.25; // Smaller steps for complete coverage
        const attackStep = 750; // Smaller steps for complete coverage

        const heatmapPoints: HeatmapPoint[] = [];

        // For each grid point in our heatmap
        for (
            let critDamage = critDamageRange.min;
            critDamage <= critDamageRange.max;
            critDamage += critDamageStep
        ) {
            for (let attack = attackRange.min; attack <= attackRange.max; attack += attackStep) {
                const stats: BaseStats = {
                    attack: attack || 1, // Avoid division by zero
                    crit: 100, // Assuming 100% crit rate for the heatmap
                    critDamage,
                    hp: 0,
                    defence: 0,
                    hacking: 0,
                    security: 0,
                    speed: 0,
                    healModifier: 0,
                };

                const critMultiplier = calculateCritMultiplier(stats);
                const dps = attack * critMultiplier;

                heatmapPoints.push({
                    x: critDamage,
                    y: attack,
                    z: dps,
                    fill: getDPSColor(dps, maxDps * 1.5), // Using 1.5x maxDps for color scaling
                });
            }
        }

        return heatmapPoints;
    }, [maxDps, shipPoints]);

    // If no data or error, show fallback
    if (shipPoints.length === 0) {
        return <ErrorFallback />;
    }

    return (
        <div className="dps-chart">
            <h2 className="text-xl font-bold mb-4">DPS Analysis Heatmap</h2>
            <div
                ref={chartContainerRef}
                style={{
                    width: '100%',
                    height,
                    position: 'relative',
                    backgroundColor: '#111827', // Dark background to match cells
                }}
            >
                {/* The chart container */}
                <ResponsiveContainer>
                    <ScatterChart>
                        <XAxis
                            type="number"
                            dataKey="x"
                            name="Crit Damage"
                            domain={[0, 275]}
                            ticks={[0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275]}
                            label={{
                                value: 'Crit Damage (%)',
                                position: 'insideBottom',
                                offset: -10,
                                fill: '#fff',
                            }}
                            tick={{ fill: '#fff' }}
                        />
                        <YAxis
                            type="number"
                            dataKey="y"
                            name="Attack"
                            domain={[0, 30000]}
                            ticks={[0, 5000, 10000, 15000, 20000, 25000, 30000]}
                            tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                            label={{
                                value: 'Attack',
                                angle: -90,
                                position: 'insideLeft',
                                offset: 10,
                                fill: '#fff',
                            }}
                            tick={{ fill: '#fff' }}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={false} />
                        <Legend content={<CustomLegend />} />

                        {/* Render the heatmap */}
                        <Scatter
                            name="DPS Heatmap"
                            data={heatmapData}
                            shape={(props: ShapeCallbackProps) => (
                                <CustomHeatmapRect
                                    cx={props.cx || 0}
                                    cy={props.cy || 0}
                                    fill={props.fill}
                                />
                            )}
                            isAnimationActive={false}
                        />

                        {/* Render ship points */}
                        <Scatter
                            name="Ships"
                            data={shipPoints}
                            shape={(props: ShapeCallbackProps) => (
                                <CustomShipShape
                                    cx={props.cx || 0}
                                    cy={props.cy || 0}
                                    payload={props.payload}
                                />
                            )}
                            zAxisId={1}
                        >
                            <LabelList
                                dataKey="name"
                                position="top"
                                fill="#fff"
                                offset={10}
                                width={100}
                            />
                        </Scatter>
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
