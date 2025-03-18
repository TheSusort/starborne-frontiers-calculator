import React, { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js-cartesian-dist-min';
import StaticChart from './StaticChart';
import { calculateCritMultiplier } from '../../utils/autogear/scoring';
import { BaseStats } from '../../types/stats';
import ErrorBoundary from '../error/ErrorBoundary';

interface ShipConfig {
    id: string;
    name: string;
    attack: number;
    critRate: number;
    critDamage: number;
    isBest?: boolean;
}

interface DPSHeatmapProps {
    ships: ShipConfig[];
}

// Use a simpler approach without complex visualizations
export const DPSHeatmap: React.FC<DPSHeatmapProps> = ({ ships = [] }) => {
    const data = useMemo(() => {
        try {
            // Create just a basic visualization - skip the heatmap entirely for now
            // Just outline the important areas with isolines

            // Generate grid lines for various DPS levels
            const lines: Partial<Data>[] = [];

            // Get the min/max values for the chart axes
            const attackValues = ships.map((ship) => ship.attack);
            const critDamageValues = ships.map((ship) => ship.critDamage);
            const minAttack = Math.min(...attackValues) || 1000;
            const maxAttack = Math.max(...attackValues) * 1.5 || 10000;
            const minCritDmg = Math.min(...critDamageValues) || 50;
            const maxCritDmg = Math.max(...critDamageValues) * 1.5 || 300;

            // Find max DPS to create reference lines
            let maxDps = 0;
            ships.forEach((ship) => {
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
                maxDps = Math.max(maxDps, dps);
            });

            // Create reference DPS lines
            const dpsLevels = [
                maxDps * 0.25,
                maxDps * 0.5,
                maxDps * 0.75,
                maxDps,
                maxDps * 1.25,
                maxDps * 1.5,
            ];

            // Create lines for each DPS level
            dpsLevels.forEach((targetDps, index) => {
                const x: number[] = [];
                const y: number[] = [];
                const step = (maxCritDmg - minCritDmg) / 20;

                // Generate points for this line
                for (let critDmg = minCritDmg; critDmg <= maxCritDmg; critDmg += step) {
                    // For each crit damage, what attack value gives this DPS?
                    // DPS = attack * (1 + critDamage/100)
                    // attack = DPS / (1 + critDamage/100)
                    const critMultiplier = 1 + critDmg / 100;
                    const attackForDps = targetDps / critMultiplier;

                    // Only add points within our attack range
                    if (attackForDps >= minAttack && attackForDps <= maxAttack) {
                        x.push(critDmg);
                        y.push(attackForDps);
                    }
                }

                // Add a line for this DPS level
                if (x.length > 1) {
                    lines.push({
                        x,
                        y,
                        type: 'scatter',
                        mode: 'lines',
                        name: `DPS: ${Math.round(targetDps).toLocaleString()}`,
                        line: {
                            color: index === 3 ? '#ec8c37' : '#888', // Highlight the max DPS line
                            width: index === 3 ? 3 : 1.5,
                            dash: index < 3 ? 'dash' : 'solid',
                        },
                        hovertemplate:
                            'DPS: ' +
                            Math.round(targetDps).toLocaleString() +
                            '<br>Attack: %{y:.2f}<br>Crit Damage: %{x}<extra></extra>',
                    });
                }
            });

            // Create traces for each ship
            const shipTraces = ships.map((ship) => {
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
                    x: [ship.critDamage],
                    y: [ship.attack],
                    type: 'scatter',
                    mode: 'markers+text',
                    marker: {
                        size: 12,
                        symbol: ship.isBest ? 'star' : 'circle',
                        color: ship.isBest ? '#ec8c37' : '#c2c2c2',
                        line: {
                            color: 'white',
                            width: 1,
                        },
                    },
                    text: [ship.name],
                    textposition: 'top center',
                    textfont: {
                        family: 'sans-serif',
                        size: 10,
                        color: ship.isBest ? '#ec8c37' : '#c2c2c2',
                    },
                    hovertemplate: `${ship.name}<br>Attack: ${ship.attack.toLocaleString()}<br>Crit Damage: ${ship.critDamage}%<br>DPS: ${Math.round(dps).toLocaleString()}<extra></extra>`,
                    showlegend: true,
                };
            }) as unknown as Partial<Data>[];

            return [...lines, ...shipTraces];
        } catch (error) {
            console.error('Error generating DPS chart:', error);

            // Return just the ship points if there's an error
            return ships.map((ship) => {
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
                    x: [ship.critDamage],
                    y: [ship.attack],
                    type: 'scatter',
                    mode: 'markers+text',
                    marker: {
                        size: 12,
                        symbol: ship.isBest ? 'star' : 'circle',
                        color: ship.isBest ? '#ec8c37' : '#c2c2c2',
                    },
                    text: [ship.name],
                    textposition: 'top center',
                    hovertemplate: `${ship.name}<br>DPS: ${Math.round(dps).toLocaleString()}<extra></extra>`,
                    showlegend: false,
                };
            }) as unknown as Partial<Data>[];
        }
    }, [ships]);

    const layout: Partial<Layout> = {
        title: {
            text: 'DPS Analysis',
            font: {
                family: 'sans-serif',
                size: 18,
            },
        },
        xaxis: {
            title: {
                text: 'Crit Damage (%)',
                font: {
                    family: 'sans-serif',
                    size: 14,
                },
            },
            gridcolor: '#444',
        },
        yaxis: {
            title: {
                text: 'Attack',
                font: {
                    family: 'sans-serif',
                    size: 14,
                },
            },
            gridcolor: '#444',
        },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: {
            color: '#fff',
        },
        margin: {
            l: 65,
            r: 80,
            b: 65,
            t: 90,
        },
        hovermode: 'closest',
        legend: {
            orientation: 'h',
            y: -0.15,
        },
    };

    return (
        <div className="dps-heatmap">
            <ErrorBoundary>
                <StaticChart data={data} layout={layout} height={500} _title="DPS Analysis" />
            </ErrorBoundary>
        </div>
    );
};
