import React, { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js-cartesian-dist-min';
import StaticChart from './StaticChart';
import { calculateDamageReduction } from '../../utils/autogear/scoring';

interface Ship {
    id: string;
    name: string;
    defense: number;
    damageReduction: number;
    isHighlighted?: boolean;
}

interface DamageReductionPlotlyProps {
    ships: Ship[];
    height?: number;
    width?: number;
    maxDefense?: number;
}

export const DamageReductionPlotly: React.FC<DamageReductionPlotlyProps> = ({
    ships = [],
    height = 400,
    width = 800,
    maxDefense = 20000,
}) => {
    const data = useMemo(() => {
        // Generate a curve of damage reduction values
        const defenseValues: number[] = [];
        const reductionValues: number[] = [];
        const step = maxDefense / 100;

        for (let defense = 0; defense <= maxDefense; defense += step) {
            defenseValues.push(defense);
            reductionValues.push(calculateDamageReduction(defense));
        }

        // Create trace for the curve
        const curveTrace: Partial<Data> = {
            x: defenseValues,
            y: reductionValues,
            type: 'scatter',
            mode: 'lines',
            name: 'Damage Reduction Curve',
            line: {
                color: '#2563eb',
                width: 2,
            },
            hovertemplate: 'Defense: %{x}<br>Damage Reduction: %{y:.2f}%<extra></extra>',
        };

        // Create traces for each ship
        const shipTraces: Partial<Data>[] = ships.map((ship) => ({
            x: [ship.defense],
            y: [ship.damageReduction],
            type: 'scatter',
            mode: 'markers+text',
            name: ship.name,
            text: [ship.name],
            textposition: 'top center',
            marker: {
                size: 10,
                symbol: ship.isHighlighted ? 'star' : 'circle',
                color: ship.isHighlighted ? '#f97316' : '#94a3b8',
                line: {
                    color: 'white',
                    width: 1,
                },
            },
            textfont: {
                color: ship.isHighlighted ? '#f97316' : '#94a3b8',
                size: 10,
            },
            hovertemplate:
                '<b>%{text}</b><br>Defense: %{x}<br>Damage Reduction: %{y:.2f}%<extra></extra>',
        }));

        return [curveTrace, ...shipTraces];
    }, [ships, maxDefense]);

    const layout: Partial<Layout> = {
        title: {
            text: 'Damage Reduction Curve',
            font: {
                family: 'Raleway',
                size: 18,
            },
        },
        xaxis: {
            title: {
                text: 'Defense',
                font: {
                    family: 'Raleway',
                    size: 14,
                },
            },
            gridcolor: '#444',
            range: [0, maxDefense],
        },
        yaxis: {
            title: {
                text: 'Damage Reduction (%)',
                font: {
                    family: 'Raleway',
                    size: 14,
                },
            },
            gridcolor: '#444',
            range: [0, 100],
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
        <div className="damage-reduction-plot">
            <StaticChart
                data={data}
                layout={layout}
                height={height}
                width={width}
                title="Damage Reduction vs Defense"
            />
        </div>
    );
};
