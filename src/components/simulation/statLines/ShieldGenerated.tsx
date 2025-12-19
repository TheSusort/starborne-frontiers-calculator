import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';
import { calculateShieldGenerated } from '../../../utils/simulation/simulationStatsCalculations';

interface ShieldGeneratedProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const ShieldGenerated: React.FC<ShieldGeneratedProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    const shieldData = calculateShieldGenerated(simulation, currentSimulation, suggestedSimulation);

    if (shieldData.value <= 0) {
        return null;
    }

    return (
        <SimulationStatDisplay
            label="Shield generated"
            value={shieldData.value}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={shieldData.current}
            suggestedValue={shieldData.suggested}
            showComparison={showComparison}
        />
    );
};
