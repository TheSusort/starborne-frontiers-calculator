import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface LowestHealProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const LowestHeal: React.FC<LowestHealProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Lowest Heal"
            value={simulation.lowestHeal || 0}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={currentSimulation?.lowestHeal}
            suggestedValue={suggestedSimulation?.lowestHeal}
            showComparison={showComparison}
        />
    );
};
