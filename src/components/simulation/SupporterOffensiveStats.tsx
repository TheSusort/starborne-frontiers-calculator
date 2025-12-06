import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from './SimulationStatDisplay';

interface SupporterOffensiveStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const SupporterOffensiveStats: React.FC<SupporterOffensiveStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    const boostSetActive = simulation.activeSets?.includes('BOOST') || false;

    return (
        <>
            <div>
                <span className="text-gray-400">Boost Set:</span>
                <span className={`ml-2 ${boostSetActive ? 'text-green-500' : 'text-red-500'}`}>
                    {boostSetActive ? 'Active' : 'Inactive'}
                </span>
            </div>
            <SimulationStatDisplay
                label="Speed"
                value={simulation.speed || 0}
                currentValue={currentSimulation?.speed}
                suggestedValue={suggestedSimulation?.speed}
                showComparison={showComparison}
                comparisonType="absolute"
            />
            <SimulationStatDisplay
                label="Attack"
                value={simulation.attack || 0}
                currentValue={currentSimulation?.attack}
                suggestedValue={suggestedSimulation?.attack}
                showComparison={showComparison}
            />
        </>
    );
};
