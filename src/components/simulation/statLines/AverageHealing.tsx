import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface AverageHealingProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const AverageHealing: React.FC<AverageHealingProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Average Healing"
            value={simulation.averageHealing || 0}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={currentSimulation?.averageHealing}
            suggestedValue={suggestedSimulation?.averageHealing}
            showComparison={showComparison}
        />
    );
};
