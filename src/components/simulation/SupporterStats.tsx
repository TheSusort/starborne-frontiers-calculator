import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { AverageHealing, HighestHeal, LowestHeal } from './statLines';

interface SupporterStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const SupporterStats: React.FC<SupporterStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <>
            <AverageHealing
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <HighestHeal
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <LowestHeal
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
        </>
    );
};
