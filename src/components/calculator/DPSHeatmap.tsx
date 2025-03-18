import React, { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js-cartesian-dist-min';
import StaticChart from './StaticChart';
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

interface DPSHeatmapProps {
    ships: ShipConfig[];
    minAttack?: number;
    maxAttack?: number;
    minCritDamage?: number;
    maxCritDamage?: number;
}

export const DPSHeatmap: React.FC<DPSHeatmapProps> = ({
    ships = [],
    minAttack,
    maxAttack,
    minCritDamage,
    maxCritDamage,
}) => {
    // Use interface rather than any for these values
    const _width = 800;
    const _height = 500;

    // If no baseAttack is provided, use the best ship's attack or the first ship's attack
    const bestShip = ships.find((ship) => ship.isBest);

    const referenceAttack = useMemo(() => {
        if (maxAttack) return maxAttack;
        if (bestShip) return bestShip.attack;
        if (ships.length > 0) return ships[0].attack;
        return 5000; // Fallback
    }, [ships, bestShip, maxAttack]);

    // Create fixed attack values at various percentages of base attack
    const attackMultipliers = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    const attackValues = attackMultipliers.map((multiplier) =>
        Math.round(referenceAttack * multiplier)
    );

    // Create fixed crit damage values
    const critDamageValues =
        minCritDamage && maxCritDamage
            ? Array.from(
                  { length: 7 },
                  (_, i) => minCritDamage + ((maxCritDamage - minCritDamage) / 6) * i
              )
            : [100, 150, 200, 250, 300, 350, 400];

    // Generate data for the contour plot
    const data = useMemo(() => {
        // Generate a grid of DPS values
        const x: number[] = []; // Crit Damage values
        const y: number[] = []; // Attack values
        const z: number[][] = []; // DPS values

        // Generate data points with step size of 5 for a smoother gradient
        const stepSize = 5;
        const numXPoints =
            Math.floor(
                (critDamageValues[critDamageValues.length - 1] - critDamageValues[0]) / stepSize
            ) + 1;
        const numYPoints =
            Math.floor((attackValues[attackValues.length - 1] - attackValues[0]) / stepSize) + 1;

        // Generate x values (crit damage %)
        for (let i = 0; i < numXPoints; i++) {
            x.push(critDamageValues[0] + i * stepSize);
        }

        // Generate y values (attack)
        for (let i = 0; i < numYPoints; i++) {
            const attack = attackValues[0] + i * stepSize;
            y.push(attack);
            z.push([]);

            // Calculate DPS for each x value (crit damage)
            for (let j = 0; j < numXPoints; j++) {
                const critDamage = critDamageValues[0] + j * stepSize;
                const stats: BaseStats = {
                    attack: 0, // Not used in calculation
                    crit: 100, // Fixed 100% crit rate
                    critDamage: critDamage,
                    hp: 0,
                    defence: 0,
                    hacking: 0,
                    security: 0, // Add security which was missing
                    speed: 0,
                    healModifier: 0,
                };
                const critMultiplier = calculateCritMultiplier(stats);
                const dps = attack * critMultiplier;
                z[i].push(dps);
            }
        }

        // Create trace for the contour plot
        const contourTrace: Partial<Data> = {
            x,
            y,
            z,
            type: 'contour',
            colorscale: 'Plasma',
            contours: {
                coloring: 'heatmap',
                showlabels: true,
                labelfont: {
                    family: 'sans-serif',
                    size: 12,
                    color: 'white',
                },
            },
            hovertemplate: 'Attack: %{y}<br>Crit Damage: %{x}%<br>DPS: %{z}<extra></extra>',
        };

        // Create traces for each ship
        const shipTraces = ships.map((ship) => {
            const stats: BaseStats = {
                attack: ship.attack,
                crit: ship.critRate,
                critDamage: ship.critDamage,
                hp: 0,
                defence: 0,
                hacking: 0,
                security: 0, // Add security which was missing
                speed: 0,
                healModifier: 0,
            };
            const critMultiplier = calculateCritMultiplier(stats);
            const dps = ship.attack * critMultiplier;

            return {
                x: [ship.critDamage],
                y: [ship.attack],
                type: 'scatter',
                mode: 'markers',
                marker: {
                    size: 12,
                    symbol: ship.isBest ? 'star' : 'circle',
                    color: ship.isBest ? '#111827' : '#fff',
                    line: {
                        color: ship.isBest ? '#fff' : '#111827',
                        width: 1,
                    },
                },
                text: [`${ship.name} (DPS: ${Math.round(dps).toLocaleString()})`],
                hovertemplate: '%{text}<extra></extra>',
                showlegend: false,
            };
        }) as unknown as Partial<Data>[];

        return [contourTrace, ...shipTraces];
    }, [ships, attackValues, critDamageValues]);

    // Define explicit layout type instead of using any
    const layout: Partial<Layout> = {
        title: {
            text: 'DPS by Attack and Crit Damage (100% Crit Rate)',
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
            r: 50,
            b: 65,
            t: 90,
        },
        hovermode: 'closest',
    };

    return (
        <div className="dps-heatmap">
            <StaticChart data={data} layout={layout} height={500} title="DPS Contour Map" />
        </div>
    );
};
