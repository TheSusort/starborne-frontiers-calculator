import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface HPProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const HP: React.FC<HPProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="HP"
            value={Math.round(simulation.hp || 0)}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={currentSimulation?.hp}
            suggestedValue={suggestedSimulation?.hp}
            showComparison={showComparison}
        />
    );
};
