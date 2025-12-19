import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';
import { GearSuggestion } from '../../../types/autogear';
import { GearPiece } from '../../../types/gear';
import { Ship } from '../../../types/ship';

interface DoTDamageProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
    ship?: Ship;
    suggestions?: GearSuggestion[];
    getGearPiece?: (id: string) => GearPiece | undefined;
}

/**
 * Calculate DoT damage with Decimation set bonus
 * Formula: hacking * (1 + decimation_multiplier)
 * Decimation provides 10% per piece (max 3 sets = 30% total)
 */
const calculateDoTDamage = (hacking: number, decimationCount: number): number => {
    const decimationMultiplier = decimationCount * 0.1; // 10% per piece
    return Math.round(hacking * (1 + decimationMultiplier));
};

export const DoTDamage: React.FC<DoTDamageProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
    ship,
    suggestions,
    getGearPiece,
}) => {
    // Count Decimation set pieces from suggestions
    const decimationCount =
        suggestions && getGearPiece
            ? suggestions.filter((suggestion) => {
                  const gear = getGearPiece(suggestion.gearId);
                  return gear?.setBonus === 'DECIMATION';
              }).length
            : 0;

    const hacking = simulation.hacking || 0;
    const dotDamage = calculateDoTDamage(hacking, decimationCount);

    // Calculate current DoT damage if we have current simulation
    const currentHacking = currentSimulation?.hacking || 0;
    const currentDecimationCount =
        ship?.equipment && getGearPiece
            ? Object.values(ship.equipment).filter((gearId) => {
                  if (!gearId) return false;
                  const gear = getGearPiece(gearId);
                  return gear?.setBonus === 'DECIMATION';
              }).length
            : 0;
    const currentDotDamage =
        currentHacking > 0 ? calculateDoTDamage(currentHacking, currentDecimationCount) : undefined;

    // Calculate suggested DoT damage
    const suggestedHacking = suggestedSimulation?.hacking || 0;
    const suggestedDotDamage =
        suggestedHacking > 0 ? calculateDoTDamage(suggestedHacking, decimationCount) : undefined;

    // Only show if there's at least one Decimation piece or if we have hacking
    if (decimationCount === 0 && hacking === 0) {
        return null;
    }

    return (
        <SimulationStatDisplay
            label="DoT Damage (with Decimation)"
            value={dotDamage}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={currentDotDamage}
            suggestedValue={suggestedDotDamage}
            showComparison={showComparison}
        />
    );
};
