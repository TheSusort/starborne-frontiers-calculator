import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, LabelList, Customized } from 'recharts';
import { calculateCritMultiplier } from '../../utils/autogear/scoring';
import { BaseStats } from '../../types/stats';
import {
    BaseChart,
    ChartLegend,
    ChartLegendItem,
    DefaultErrorFallback,
    LINE_CHART_MARGIN,
} from '../ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';

interface DPSChartShipEntry {
    id: string;
    name: string;
    attack: number;
    critRate: number;
    critDamage: number;
    isBest?: boolean;
}

interface DPSChartProps {
    ships: DPSChartShipEntry[];
    height?: number;
}

// DPS heatmap data point
interface HeatmapPoint {
    x: number; // crit damage
    y: number; // attack
    z: number; // DPS
    fill: string; // Color for the point
}

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
                    <p className="text-xs text-theme-text-secondary">
                        {data.isBest ? 'Best DPS' : ''}
                    </p>
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

interface RechartsAxisEntry {
    scale?: (v: number) => number;
}

interface RechartsInternalProps {
    xAxisMap?: Record<string, RechartsAxisEntry>;
    yAxisMap?: Record<string, RechartsAxisEntry>;
}

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

const HEATMAP_LEGEND_ITEMS: ChartLegendItem[] = [
    { label: '< 20% max DPS', color: '#00008B' },
    { label: '20-40% max DPS', color: '#0000CD' },
    { label: '40-60% max DPS', color: '#1E90FF' },
    { label: '60-80% max DPS', color: '#00BFFF' },
    { label: '80-100% max DPS', color: '#87CEEB' },
    { label: '100-125% max DPS', color: '#FFD700' },
    { label: '125-150% max DPS', color: '#FFA500' },
    { label: '> 150% max DPS', color: '#FF4500' },
];

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
    const colors = useThemeColors();

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

    // Dynamic attack range — always covers the ship's actual attack value
    const attackMax = useMemo(() => {
        const maxShipAttack = Math.max(...(shipPoints.map((p) => p.y) || [30000]));
        return Math.ceil(Math.max(30000, maxShipAttack * 1.5) / 5000) * 5000;
    }, [shipPoints]);

    // Generate heatmap data
    const { heatmapData, critDamageStep, attackStep } = useMemo(() => {
        if (maxDps === 0 || shipPoints.length === 0)
            return { heatmapData: [], critDamageStep: 6.25, attackStep: 250 };

        const cdStep = 6.25;
        const aStep = Math.ceil(attackMax / 40 / 250) * 250;

        const heatmapPoints: HeatmapPoint[] = [];

        for (let critDamage = 0; critDamage <= 325; critDamage += cdStep) {
            for (let attack = 0; attack <= attackMax; attack += aStep) {
                const stats: BaseStats = {
                    attack: attack || 1,
                    crit: 100,
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
                    fill: getDPSColor(dps, maxDps * 1.5),
                });
            }
        }

        return { heatmapData: heatmapPoints, critDamageStep: cdStep, attackStep: aStep };
    }, [maxDps, shipPoints, attackMax]);

    // If no data or error, show fallback
    if (shipPoints.length === 0) {
        return (
            <DefaultErrorFallback
                title="Chart Error"
                message="There was an error rendering the DPS Analysis chart. You can still view and compare your ship configurations using the data cards above."
            />
        );
    }

    return (
        <div className="dps-chart">
            <h2 className="text-xl font-bold mb-4">DPS Analysis Heatmap</h2>
            <div
                style={{
                    width: '100%',
                    height,
                    position: 'relative',
                    backgroundColor: colors.bg,
                }}
            >
                {/* The chart container */}
                <BaseChart
                    height={height}
                    error={shipPoints.length === 0 ? new Error('No data') : null}
                    errorFallback={
                        <DefaultErrorFallback
                            title="Chart Error"
                            message="There was an error rendering the DPS Analysis chart. You can still view and compare your ship configurations using the data cards above."
                        />
                    }
                >
                    <ScatterChart margin={LINE_CHART_MARGIN}>
                        <XAxis
                            type="number"
                            dataKey="x"
                            name="Crit Damage"
                            domain={[0, 325]}
                            ticks={[
                                0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325,
                            ]}
                            label={{
                                value: 'Crit Damage (%)',
                                position: 'insideBottom',
                                offset: -10,
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <YAxis
                            type="number"
                            dataKey="y"
                            name="Attack"
                            domain={[0, attackMax]}
                            ticks={Array.from(
                                { length: Math.floor(attackMax / 5000) + 1 },
                                (_, i) => i * 5000
                            )}
                            tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                            label={{
                                value: 'Attack',
                                angle: -90,
                                position: 'insideLeft',
                                offset: 10,
                                fill: colors.text,
                            }}
                            tick={{ fill: colors.text }}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={false} />

                        {/* Pixel-perfect heatmap using axis scale functions */}
                        <Customized
                            component={(rProps: RechartsInternalProps) => {
                                const xAxis = Object.values(rProps.xAxisMap ?? {})[0];
                                const yAxis = Object.values(rProps.yAxisMap ?? {})[0];
                                if (!xAxis?.scale || !yAxis?.scale) return null;
                                const xs = xAxis.scale;
                                const ys = yAxis.scale;
                                const cellW = Math.abs(xs(critDamageStep) - xs(0));
                                const cellH = Math.abs(ys(0) - ys(attackStep));
                                return (
                                    <g pointerEvents="none">
                                        {heatmapData.map((d, i) => (
                                            <rect
                                                key={i}
                                                x={xs(d.x)}
                                                y={ys(d.y) - cellH}
                                                width={cellW}
                                                height={cellH}
                                                fill={d.fill}
                                                stroke="none"
                                            />
                                        ))}
                                    </g>
                                );
                            }}
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
                                fill={colors.text}
                                offset={10}
                                width={100}
                            />
                        </Scatter>
                    </ScatterChart>
                </BaseChart>
            </div>
            <ChartLegend items={HEATMAP_LEGEND_ITEMS} shape="square" />
        </div>
    );
};
