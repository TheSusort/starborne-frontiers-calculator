import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { Ship } from '../../types/ship';
import { GearSuggestion } from '../../types/autogear';
import { GearPiece } from '../../types/gear';
import { Hacking100PercentSuccess, Hacking, DoTDamage, AverageDamage } from './statLines';

interface DebufferCorrosionStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
    ship?: Ship;
    suggestions?: GearSuggestion[];
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export const DebufferCorrosionStats: React.FC<DebufferCorrosionStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
    ship,
    suggestions,
    getGearPiece,
}) => {
    return (
        <>
            <Hacking100PercentSuccess
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <Hacking
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <AverageDamage
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
                ship={ship}
                suggestions={suggestions}
                getGearPiece={getGearPiece}
            />
        </>
    );
};
