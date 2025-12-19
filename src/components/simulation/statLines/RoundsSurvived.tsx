import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface RoundsSurvivedProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const RoundsSurvived: React.FC<RoundsSurvivedProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Rounds Survived"
            value={Math.floor(simulation.survivedRounds || 0)}
            currentValue={currentSimulation?.survivedRounds}
            suggestedValue={suggestedSimulation?.survivedRounds}
            showComparison={showComparison}
        />
    );
};
