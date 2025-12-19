import { useMemo } from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { Ship } from '../../../types/ship';
import { GearSuggestion } from '../../../types/autogear';
import { GearPiece } from '../../../types/gear';
import {
    getArcaneSiegeInfo,
    countShieldGearInSuggestions,
} from '../../../utils/autogear/arcaneSiegeUtils';

interface UseArcaneSiegeDamageProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    ship?: Ship;
    suggestions?: GearSuggestion[];
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export interface ArcaneSiegeDamageInfo {
    hasImplant: boolean;
    multiplier: number;
    rarity: string | null;
    isShieldSetActive: boolean;
    isCurrentShieldSetActive: boolean;
    displayedDamage: number;
    displayedDamageForCurrent: number;
    displayedDamageForSuggested: number;
    shieldedDamage: number | null;
    currentDisplayedDamage?: number;
    suggestedDisplayedDamage?: number;
}

/**
 * Hook to calculate Arcane Siege damage adjustments for display
 */
export function useArcaneSiegeDamage({
    simulation,
    currentSimulation,
    suggestedSimulation,
    ship,
    suggestions,
    getGearPiece,
}: UseArcaneSiegeDamageProps): ArcaneSiegeDamageInfo {
    return useMemo(() => {
        // Check for Arcane Siege if we have the necessary data
        const arcaneSiegeInfo =
            ship && getGearPiece
                ? getArcaneSiegeInfo(ship, getGearPiece)
                : { hasImplant: false, multiplier: 0, rarity: null };

        const shieldCount =
            suggestions && getGearPiece
                ? countShieldGearInSuggestions(suggestions, getGearPiece)
                : 0;

        // Shield set bonus is active if we have 2+ shield pieces (for suggested configuration)
        const isShieldSetActive = shieldCount >= 2;

        // Check if current configuration has shield set active
        const currentShieldCount =
            ship?.equipment && getGearPiece
                ? Object.values(ship.equipment).filter((gearId) => {
                      if (!gearId) return false;
                      const gear = getGearPiece(gearId);
                      return gear?.setBonus === 'SHIELD';
                  }).length
                : 0;
        const isCurrentShieldSetActive = currentShieldCount >= 2;

        // Calculate base damage and shielded damage for current configuration
        const currentBaseDamage = currentSimulation?.averageDamage || simulation.averageDamage || 0;
        const currentShieldedDamage =
            arcaneSiegeInfo.hasImplant && currentBaseDamage
                ? currentBaseDamage * (1 + arcaneSiegeInfo.multiplier / 100)
                : null;

        // Calculate base damage and shielded damage for suggested configuration
        const suggestedBaseDamage =
            suggestedSimulation?.averageDamage || simulation.averageDamage || 0;
        const suggestedShieldedDamage =
            arcaneSiegeInfo.hasImplant && suggestedBaseDamage
                ? suggestedBaseDamage * (1 + arcaneSiegeInfo.multiplier / 100)
                : null;

        // Calculate displayed damage based on whether we're showing current or suggested
        const displayedDamageForCurrent =
            isCurrentShieldSetActive && currentShieldedDamage !== null
                ? currentShieldedDamage
                : currentBaseDamage;
        const displayedDamageForSuggested =
            isShieldSetActive && suggestedShieldedDamage !== null
                ? suggestedShieldedDamage
                : suggestedBaseDamage;

        // Default to suggested for backward compatibility, but component will choose the right one
        const displayedDamage = displayedDamageForSuggested;

        // For backward compatibility, also calculate the old shieldedDamage
        const baseDamage = simulation.averageDamage || 0;
        const shieldedDamage =
            arcaneSiegeInfo.hasImplant && simulation.averageDamage
                ? simulation.averageDamage * (1 + arcaneSiegeInfo.multiplier / 100)
                : null;

        // Calculate current displayed damage if we have current simulation
        let currentDisplayedDamage: number | undefined;
        if (currentSimulation?.averageDamage) {
            if (arcaneSiegeInfo.hasImplant && isCurrentShieldSetActive) {
                currentDisplayedDamage =
                    currentSimulation.averageDamage * (1 + arcaneSiegeInfo.multiplier / 100);
            } else {
                currentDisplayedDamage = currentSimulation.averageDamage;
            }
        }

        // Calculate suggested displayed damage if we have suggested simulation
        // When shield is active, apply the multiplier to suggested damage as well
        let suggestedDisplayedDamage: number | undefined;
        if (suggestedSimulation?.averageDamage) {
            if (arcaneSiegeInfo.hasImplant && isShieldSetActive) {
                suggestedDisplayedDamage =
                    suggestedSimulation.averageDamage * (1 + arcaneSiegeInfo.multiplier / 100);
            } else {
                suggestedDisplayedDamage = suggestedSimulation.averageDamage;
            }
        }

        return {
            hasImplant: arcaneSiegeInfo.hasImplant,
            multiplier: arcaneSiegeInfo.multiplier,
            rarity: arcaneSiegeInfo.rarity,
            isShieldSetActive,
            isCurrentShieldSetActive,
            displayedDamage,
            displayedDamageForCurrent,
            displayedDamageForSuggested,
            shieldedDamage,
            currentDisplayedDamage,
            suggestedDisplayedDamage,
        };
    }, [
        simulation.averageDamage,
        currentSimulation?.averageDamage,
        suggestedSimulation?.averageDamage,
        ship,
        suggestions,
        getGearPiece,
    ]);
}
