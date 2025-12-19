import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from '../SimulationStatDisplay';

interface BombDamageProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
    level: 1 | 2 | 3;
}

/**
 * Calculates bomb damage based on attack stat
 * Bomb I = 100% Attack, Bomb II = 200% Attack, Bomb III = 300% Attack
 */
const calculateBombDamage = (attack: number, bombLevel: 1 | 2 | 3 = 2): number => {
    return Math.round(attack * bombLevel);
};

export const BombDamage: React.FC<BombDamageProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
    level,
}) => {
    const attack = simulation.attack || 0;
    const bombDamage = calculateBombDamage(attack, level);

    const currentBombDamage = currentSimulation?.attack
        ? calculateBombDamage(currentSimulation.attack, level)
        : undefined;

    const suggestedBombDamage = suggestedSimulation?.attack
        ? calculateBombDamage(suggestedSimulation.attack, level)
        : undefined;

    const label = `Bomb ${level === 1 ? 'I' : level === 2 ? 'II' : 'III'} Damage`;

    return (
        <SimulationStatDisplay
            label={label}
            value={bombDamage}
            formatValue={(val) => Number(val).toLocaleString()}
            currentValue={currentBombDamage}
            suggestedValue={suggestedBombDamage}
            showComparison={showComparison}
        />
    );
};
