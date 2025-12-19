import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface HighestHealProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const HighestHeal: React.FC<HighestHealProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Highest Heal"
            value={simulation.highestHeal || 0}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={currentSimulation?.highestHeal}
            suggestedValue={suggestedSimulation?.highestHeal}
            showComparison={showComparison}
        />
    );
};
