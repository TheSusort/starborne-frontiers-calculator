import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface EffectiveHPProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const EffectiveHP: React.FC<EffectiveHPProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Effective HP"
            value={simulation.effectiveHP || 0}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={currentSimulation?.effectiveHP}
            suggestedValue={suggestedSimulation?.effectiveHP}
            showComparison={showComparison}
        />
    );
};
