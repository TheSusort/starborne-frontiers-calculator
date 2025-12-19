import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface CritRateProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const CritRate: React.FC<CritRateProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    if (simulation.critRate === undefined) {
        return null;
    }

    return (
        <SimulationStatDisplay
            label="Crit Rate"
            value={simulation.critRate * 100}
            formatValue={(val) => `${val}%`}
            currentValue={
                currentSimulation?.critRate ? currentSimulation.critRate * 100 : undefined
            }
            suggestedValue={
                suggestedSimulation?.critRate ? suggestedSimulation.critRate * 100 : undefined
            }
            showComparison={showComparison}
        />
    );
};
