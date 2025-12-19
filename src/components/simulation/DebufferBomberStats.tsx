import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { Ship } from '../../types/ship';
import { GearSuggestion } from '../../types/autogear';
import { GearPiece } from '../../types/gear';
import { Hacking100PercentSuccess, Attack, BombDamage, AverageDamage } from './statLines';

interface DebufferBomberStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
    ship?: Ship;
    suggestions?: GearSuggestion[];
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export const DebufferBomberStats: React.FC<DebufferBomberStatsProps> = ({
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
            <BombDamage
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
                level={3}
            />
            <BombDamage
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
                level={2}
            />
            <BombDamage
                simulation={simulation}
                currentSimulation={currentSimulation}
                suggestedSimulation={suggestedSimulation}
                showComparison={showComparison}
                level={1}
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
