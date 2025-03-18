import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Scatter,
    Legend,
    ComposedChart,
    ReferenceDot,
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

const ErrorFallback = () => (
    <div className="bg-dark p-4 border border-red-500 rounded">
        <h3 className="text-lg font-bold text-red-500 mb-2">Chart Error</h3>
        <p className="mb-2">There was an error rendering the DPS Analysis chart.</p>
        <p>You can still view and compare your ship configurations using the data cards above.</p>
    </div>
);

// Custom tooltip component
const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;

        if (data.isShipPoint) {
            // Ship point tooltip
            return (
                <div className="bg-dark-lighter p-2 border border-dark-border text-white">
                    <p className="font-bold">{data.name}</p>
                    <p>Attack: {(data.attack / 1000).toFixed(1)}k</p>
                    <p>Crit Damage: {data.critDamage}%</p>
                    <p>DPS: {(data.dps / 1000).toFixed(1)}k</p>
                </div>
            );
        } else {
            // DPS line tooltip
            return (
                <div className="bg-dark-lighter p-2 border border-dark-border text-white">
                    <p>DPS Level: {(Math.round(data.dps || 0) / 1000).toFixed(1)}k</p>
                    <p>Attack: {(Math.round(data.attack || 0) / 1000).toFixed(1)}k</p>
                    <p>Crit Damage: {Math.round(data.critDamage || 0)}%</p>
                </div>
            );
        }
    }
    return null;
};

export const DPSChart: React.FC<DPSChartProps> = ({ ships = [], height = 500 }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [mousePosition, setMousePosition] = useState<{
        x: number;
        y: number;
        critDamage: number | null;
        attack: number | null;
    } | null>(null);

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
                    name: ship.name,
                    id: ship.id,
                    attack: ship.attack,
                    critDamage: ship.critDamage,
                    critRate: ship.critRate,
                    dps,
                    isBest: ship.isBest,
                    isShipPoint: true,
                };
            });

            const maxDpsValue = Math.max(...points.map((p) => p.dps));
            return { shipPoints: points, maxDps: maxDpsValue };
        } catch (error) {
            console.error('Error generating DPS chart data:', error);
            return { shipPoints: [], maxDps: 0 };
        }
    }, [ships]);

    // Generate simple data for isolines
    const isolineData = useMemo(() => {
        if (maxDps === 0 || shipPoints.length === 0) return [];

        // Create isoline data points
        // We'll create simplified isoline data
        const allData: Array<{
            name: string;
            values: Array<{ critDamage: number; attack: number; dps: number }>;
            color: string;
            dash: boolean;
        }> = [];

        // DPS levels as percentages of the max
        const dpsLevels = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5];

        // Get min/max values for axes
        const attackValues = shipPoints.map((ship) => ship.attack);
        const critDamageValues = shipPoints.map((ship) => ship.critDamage);
        const minAttack = Math.min(...attackValues) * 0.5 || 1000;
        const maxAttack = Math.max(...attackValues) * 1.5 || 10000;
        const minCritDmg = Math.min(...critDamageValues) * 0.8 || 50;
        const maxCritDmg = Math.max(...critDamageValues) * 1.2 || 300;

        dpsLevels.forEach((level, index) => {
            const dpsValue = maxDps * level;
            const values = [];

            // Create points for this isoline
            for (let critDmg = minCritDmg; critDmg <= maxCritDmg; critDmg += 10) {
                const critMultiplier = 1 + critDmg / 100;
                const attackForDps = dpsValue / critMultiplier;

                if (attackForDps >= minAttack && attackForDps <= maxAttack) {
                    values.push({
                        critDamage: critDmg,
                        attack: attackForDps,
                        dps: dpsValue,
                    });
                }
            }

            allData.push({
                name: `DPS: ${Math.round(dpsValue).toLocaleString()}`,
                values,
                color: level === 1.0 ? '#ec8c37' : '#888',
                dash: level < 1.0,
            });
        });

        return allData;
    }, [maxDps, shipPoints]);

    // If no data or error, show fallback
    if (shipPoints.length === 0) {
        return <ErrorFallback />;
    }

    // Mouse move handler for the transparent overlay
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!chartContainerRef.current) return;

        // Get chart container position
        const rect = chartContainerRef.current.getBoundingClientRect();

        // Calculate position relative to chart container
        const relativeX = e.clientX - rect.left;
        const relativeY = e.clientY - rect.top;

        // Skip if mouse is outside the main chart area (adjust for margins)
        if (
            relativeX < 40 ||
            relativeX > rect.width - 20 ||
            relativeY < 20 ||
            relativeY > rect.height - 40
        ) {
            return;
        }

        // Calculate effective chart area
        const chartWidth = rect.width - 60; // Left and right margins
        const chartHeight = rect.height - 60; // Top and bottom margins

        // Calculate position within the actual data area
        const xRatio = (relativeX - 40) / chartWidth;
        const yRatio = (relativeY - 20) / chartHeight;

        // Map to data range
        const critDamage = Math.round(50 + xRatio * (275 - 50));
        const attack = Math.round(30000 * (1 - yRatio));

        setMousePosition({
            x: relativeX,
            y: relativeY,
            critDamage,
            attack,
        });
    };

    const handleMouseLeave = () => {
        setMousePosition(null);
    };

    // Calculate DPS based on estimated position
    const dps =
        mousePosition?.attack && mousePosition?.critDamage
            ? mousePosition.attack * (1 + mousePosition.critDamage / 100)
            : null;

    return (
        <div className="dps-chart">
            <h2 className="text-xl font-bold mb-4">DPS Analysis</h2>
            <div ref={chartContainerRef} style={{ width: '100%', height, position: 'relative' }}>
                {/* The chart container */}
                <ResponsiveContainer>
                    <ComposedChart margin={{ top: 20, right: 20, bottom: 20, left: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                        <XAxis
                            type="number"
                            dataKey="critDamage"
                            name="Crit Damage"
                            label={{
                                value: 'Crit Damage (%)',
                                position: 'insideBottomRight',
                                offset: -10,
                                fill: '#fff',
                            }}
                            tick={{ fill: '#fff' }}
                            domain={['auto', 'auto']}
                        />
                        <YAxis
                            type="number"
                            dataKey="attack"
                            name="Attack"
                            label={{
                                value: 'Attack',
                                angle: -90,
                                position: 'insideLeft',
                                fill: '#fff',
                            }}
                            tick={{ fill: '#fff' }}
                            domain={['auto', 'auto']}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />

                        {/* Render the isolines */}
                        {isolineData.map((line, index) => (
                            <Line
                                key={`isoline-${index}`}
                                data={line.values}
                                dataKey="attack"
                                type="monotone"
                                name={line.name}
                                stroke={line.color}
                                strokeWidth={line.name.includes('100%') ? 3 : 1.5}
                                strokeDasharray={line.dash ? '5 5' : '0'}
                                dot={false}
                                activeDot={{ r: 6, fill: line.color, stroke: '#fff' }}
                                isAnimationActive={false}
                            />
                        ))}

                        {/* Render ship points */}
                        <Scatter
                            name="Ships"
                            data={shipPoints}
                            fill="#c2c2c2"
                            stroke="#fff"
                            strokeWidth={1}
                            dataKey="critDamage"
                        >
                            <LabelList
                                dataKey="name"
                                position="top"
                                fill="#fff"
                                offset={10}
                                width={100}
                            />
                        </Scatter>

                        {/* Add special markers for best ships */}
                        {shipPoints
                            .filter((ship) => ship.isBest)
                            .map((ship) => (
                                <ReferenceDot
                                    key={ship.id}
                                    x={ship.critDamage}
                                    y={ship.attack}
                                    r={8}
                                    fill="#ec8c37"
                                    stroke="white"
                                    strokeWidth={1}
                                />
                            ))}
                    </ComposedChart>
                </ResponsiveContainer>

                {/* Transparent overlay for mouse tracking */}
                <div
                    className="absolute inset-0"
                    style={{ pointerEvents: 'all', zIndex: 20 }}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                />

                {/* Display coordinate info on hover */}
                {mousePosition && (
                    <div
                        className="absolute bg-dark-lighter p-2 border border-dark-border text-white text-sm"
                        style={{
                            left: (mousePosition.x || 0) + 10,
                            top: (mousePosition.y || 0) + 10,
                            zIndex: 30,
                            pointerEvents: 'none',
                        }}
                    >
                        <p>Crit Damage: {mousePosition.critDamage}%</p>
                        <p>Attack: {((mousePosition.attack || 0) / 1000).toFixed(1)}k</p>
                        <p>Est. DPS: {((dps || 0) / 1000).toFixed(1)}k</p>
                    </div>
                )}
            </div>
        </div>
    );
};
