import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface HackingProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const Hacking: React.FC<HackingProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <SimulationStatDisplay
            label="Hacking"
            value={simulation.hacking || 0}
            currentValue={currentSimulation?.hacking}
            suggestedValue={suggestedSimulation?.hacking}
            showComparison={showComparison}
        />
    );
};
