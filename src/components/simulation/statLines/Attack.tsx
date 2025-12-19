import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface AttackProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const Attack: React.FC<AttackProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Attack"
            value={simulation.attack || 0}
            currentValue={currentSimulation?.attack}
            suggestedValue={suggestedSimulation?.attack}
            showComparison={showComparison}
        />
    );
};
