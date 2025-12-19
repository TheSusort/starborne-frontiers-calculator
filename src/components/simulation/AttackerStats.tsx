import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { Ship } from '../../types/ship';
import { GearSuggestion } from '../../types/autogear';
import { GearPiece } from '../../types/gear';
import { AverageDamage, HighestHit, LowestHit, CritRate } from './statLines';

interface AttackerStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
    ship?: Ship;
    suggestions?: GearSuggestion[];
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export const AttackerStats: React.FC<AttackerStatsProps> = ({
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
            <AverageDamage
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
                ship={ship}
                suggestions={suggestions}
                getGearPiece={getGearPiece}
            />
            <HighestHit
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <LowestHit
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
            <CritRate
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
            />
        </>
    );
};
