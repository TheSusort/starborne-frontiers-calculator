import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';
import { calculateHealingOnHit } from '../../../utils/simulation/simulationStatsCalculations';

interface HealedOnHitProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const HealedOnHit: React.FC<HealedOnHitProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    const healingData = calculateHealingOnHit(simulation, currentSimulation, suggestedSimulation);

    if (healingData.value <= 0) {
        return null;
    }

    return (
        <SimulationStatDisplay
            label="Healed on hit"
            value={healingData.value}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={healingData.current}
            suggestedValue={healingData.suggested}
            showComparison={showComparison}
        />
    );
};
