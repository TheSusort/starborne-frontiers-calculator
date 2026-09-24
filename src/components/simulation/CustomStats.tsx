import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from './SimulationStatDisplay';

interface CustomStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

/**
 * The Custom-formula counterpart to the role stat panels (`AttackerStats.tsx`, etc.): renders
 * whatever `runSimulation`'s custom-formula branch actually computed — the formula score always,
 * damage/EHP only when the formula carries a usable core row for them
 * (`simulationCalculator.ts`'s `runCustomFormulaSimulation`).
 */
export const CustomStats: React.FC<CustomStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <>
            <SimulationStatDisplay
                label="Formula Score"
                value={simulation.formulaScore ?? 0}
                formatValue={(val) =>
                    Number(val).toLocaleString(undefined, { maximumFractionDigits: 3 })
                }
                currentValue={currentSimulation?.formulaScore}
                suggestedValue={suggestedSimulation?.formulaScore}
                showComparison={showComparison}
            />
            {simulation.averageDamage !== undefined && (
                <SimulationStatDisplay
                    label="Average Damage"
                    value={simulation.averageDamage}
                    formatValue={(val) => Number(val).toLocaleString()}
                    currentValue={currentSimulation?.averageDamage}
                    suggestedValue={suggestedSimulation?.averageDamage}
                    showComparison={showComparison}
                />
            )}
            {simulation.effectiveHP !== undefined && (
                <SimulationStatDisplay
                    label="Effective HP"
                    value={simulation.effectiveHP}
                    formatValue={(val) => Number(val).toLocaleString()}
                    currentValue={currentSimulation?.effectiveHP}
                    suggestedValue={suggestedSimulation?.effectiveHP}
                    showComparison={showComparison}
                />
            )}
        </>
    );
};
