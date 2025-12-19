import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface SpeedProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
    comparisonType?: 'percentage' | 'absolute';
}

export const Speed: React.FC<SpeedProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
    comparisonType = 'percentage',
}) => {
    return (
        <SimulationStatDisplay
            label="Speed"
            value={simulation.speed || 0}
            currentValue={currentSimulation?.speed}
            suggestedValue={suggestedSimulation?.speed}
            showComparison={showComparison}
            comparisonType={comparisonType}
        />
    );
};
