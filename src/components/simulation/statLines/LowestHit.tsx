import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface LowestHitProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const LowestHit: React.FC<LowestHitProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Lowest Hit"
            value={simulation.lowestHit || 0}
            currentValue={currentSimulation?.lowestHit}
            suggestedValue={suggestedSimulation?.lowestHit}
            showComparison={showComparison}
        />
    );
};
