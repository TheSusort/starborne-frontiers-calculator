import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from './SimulationStatDisplay';

interface SupporterStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const SupporterStats: React.FC<SupporterStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <>
            <SimulationStatDisplay
                label="Average Healing"
                value={simulation.averageHealing || 0}
                formatValue={(val) => Number(val).toLocaleString()}
                currentValue={currentSimulation?.averageHealing}
                suggestedValue={suggestedSimulation?.averageHealing}
                showComparison={showComparison}
            />
            <SimulationStatDisplay
                label="Highest Heal"
                value={simulation.highestHeal || 0}
                formatValue={(val) => Number(val).toLocaleString()}
                currentValue={currentSimulation?.highestHeal}
                suggestedValue={suggestedSimulation?.highestHeal}
                showComparison={showComparison}
            />
            <SimulationStatDisplay
                label="Lowest Heal"
                value={simulation.lowestHeal || 0}
                formatValue={(val) => Number(val).toLocaleString()}
                currentValue={currentSimulation?.lowestHeal}
                suggestedValue={suggestedSimulation?.lowestHeal}
                showComparison={showComparison}
            />
        </>
    );
};
