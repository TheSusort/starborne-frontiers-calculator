import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { BoostSetStatus, Speed, Attack } from './statLines';

interface SupporterOffensiveStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const SupporterOffensiveStats: React.FC<SupporterOffensiveStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <>
            <BoostSetStatus simulation={simulation} />
            <Speed
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
                comparisonType="absolute"
            />
            <Attack
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
        </>
    );
};
