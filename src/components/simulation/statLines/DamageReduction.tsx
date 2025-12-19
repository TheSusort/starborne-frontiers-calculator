import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface DamageReductionProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const DamageReduction: React.FC<DamageReductionProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Damage Reduction"
            value={simulation.damageReduction || 0}
            formatValue={(val) => `${val}%`}
            currentValue={currentSimulation?.damageReduction}
            suggestedValue={suggestedSimulation?.damageReduction}
            showComparison={showComparison}
            comparisonType="absolute"
        />
    );
};
