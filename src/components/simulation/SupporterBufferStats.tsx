import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { BoostSetStatus, Speed, EffectiveHP, DamageReduction } from './statLines';

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
    return (
        <>
            <BoostSetStatus simulation={simulation} />
            <Speed
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <EffectiveHP
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <DamageReduction
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
        </>
    );
};
