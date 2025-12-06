import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from './SimulationStatDisplay';

interface SupporterBufferStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const SupporterBufferStats: React.FC<SupporterBufferStatsProps> = ({
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
            <SimulationStatDisplay label="Speed" value={simulation.speed || 0} />
            <SimulationStatDisplay
                label="Effective HP"
                value={simulation.effectiveHP || 0}
                formatValue={(val) => Number(val).toLocaleString()}
                currentValue={currentSimulation?.effectiveHP}
                suggestedValue={suggestedSimulation?.effectiveHP}
                showComparison={showComparison}
            />
            <SimulationStatDisplay
                label="Damage Reduction"
                value={simulation.damageReduction || 0}
                formatValue={(val) => `${val}%`}
                currentValue={currentSimulation?.damageReduction}
                suggestedValue={suggestedSimulation?.damageReduction}
                showComparison={showComparison}
                comparisonType="absolute"
            />
        </>
    );
};
