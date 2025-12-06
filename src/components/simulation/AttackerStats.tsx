import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from './SimulationStatDisplay';

interface AttackerStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const AttackerStats: React.FC<AttackerStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    return (
        <>
            <SimulationStatDisplay
                label="Average Damage"
                value={simulation.averageDamage || 0}
                currentValue={currentSimulation?.averageDamage}
                suggestedValue={suggestedSimulation?.averageDamage}
                showComparison={showComparison}
            />
            <SimulationStatDisplay label="Highest Hit" value={simulation.highestHit || 0} />
            <SimulationStatDisplay label="Lowest Hit" value={simulation.lowestHit || 0} />
            {simulation.critRate !== undefined && (
                <SimulationStatDisplay
                    label="Crit Rate"
                    value={simulation.critRate * 100}
                    formatValue={(val) => `${val}%`}
                />
            )}
        </>
    );
};
