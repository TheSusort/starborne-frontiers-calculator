import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';
import { Ship } from '../../../types/ship';
import { GearSuggestion } from '../../../types/autogear';
import { GearPiece } from '../../../types/gear';
import { useArcaneSiegeDamage } from '../hooks/useArcaneSiegeDamage';
import { ArcaneSiegeNotice } from '../notices/ArcaneSiegeNotice';

interface AverageDamageProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
    ship?: Ship;
    suggestions?: GearSuggestion[];
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export const AverageDamage: React.FC<AverageDamageProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
    ship,
    suggestions,
    getGearPiece,
}) => {
    const arcaneSiege = useArcaneSiegeDamage({
        simulation,
        currentSimulation,
        suggestedSimulation,
        ship,
        suggestions,
        getGearPiece,
    });

    // Determine which shield status to use based on whether we're showing current or suggested
    const shieldStatusForDisplay = showComparison
        ? arcaneSiege.isShieldSetActive
        : arcaneSiege.isCurrentShieldSetActive;

    // Use the appropriate displayed damage based on whether we're showing current or suggested
    const displayedDamage = showComparison
        ? arcaneSiege.displayedDamageForSuggested
        : arcaneSiege.displayedDamageForCurrent;

    return (
        <>
            {arcaneSiege.hasImplant && (
                <ArcaneSiegeNotice
                    rarity={arcaneSiege.rarity}
                    multiplier={arcaneSiege.multiplier}
                    isShieldSetActive={shieldStatusForDisplay}
                />
            )}
            <SimulationStatDisplay
                label="Average Damage"
                value={Math.round(displayedDamage)}
                currentValue={arcaneSiege.currentDisplayedDamage}
                suggestedValue={arcaneSiege.suggestedDisplayedDamage}
                showComparison={showComparison}
                arcaneSiegeInfo={
                    arcaneSiege.hasImplant && showComparison && !arcaneSiege.isShieldSetActive
                        ? {
                              multiplier: arcaneSiege.multiplier,
                              isShielded: false,
                              shieldedDamage: arcaneSiege.shieldedDamage,
                          }
                        : undefined
                }
            />
        </>
    );
};
