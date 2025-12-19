import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface SecurityProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const Security: React.FC<SecurityProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Security"
            value={simulation.security || 0}
            currentValue={currentSimulation?.security}
            suggestedValue={suggestedSimulation?.security}
            showComparison={showComparison}
        />
    );
};
