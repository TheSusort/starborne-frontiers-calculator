import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { EffectiveHP } from './statLines';

interface SupporterShieldStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const SupporterShieldStats: React.FC<SupporterShieldStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <>
            <EffectiveHP
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
        </>
    );
};
