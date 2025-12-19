import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface HighestHitProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const HighestHit: React.FC<HighestHitProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Highest Hit"
            value={simulation.highestHit || 0}
            currentValue={currentSimulation?.highestHit}
            suggestedValue={suggestedSimulation?.highestHit}
            showComparison={showComparison}
        />
    );
};
