import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from './SimulationStatDisplay';

interface DebufferStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

/**
 * Calculates the security threshold for 100% hack success rate
 * Formula: Security for 100% = hacking - 100
 */
const calculateSecurityFor100Percent = (hacking: number): number => {
    return Math.max(0, Math.round(hacking - 100));
};

/**
 * Calculates bomb damage based on attack stat
 * Bomb I = 100% Attack, Bomb II = 200% Attack, Bomb III = 300% Attack
 */
const calculateBombDamage = (attack: number, bombLevel: 1 | 2 | 3 = 2): number => {
    return Math.round(attack * bombLevel);
};

export const DebufferStats: React.FC<DebufferStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    const hacking = simulation.hacking || 0;
    const attack = simulation.attack || 0;
    const securityFor100Percent = calculateSecurityFor100Percent(hacking);

    const currentHacking = currentSimulation?.hacking;
    const suggestedHacking = suggestedSimulation?.hacking;

    const currentSecurityFor100Percent = currentHacking
        ? calculateSecurityFor100Percent(currentHacking)
        : undefined;

    const suggestedSecurityFor100Percent = suggestedHacking
        ? calculateSecurityFor100Percent(suggestedHacking)
        : undefined;

    // Calculate bomb damage
    const bombIIIDamage = calculateBombDamage(attack, 3);
    const bombIIDamage = calculateBombDamage(attack, 2);
    const bombIDamage = calculateBombDamage(attack, 1);

    const currentBombIIIDamage = currentSimulation?.attack
        ? calculateBombDamage(currentSimulation.attack, 3)
        : undefined;
    const suggestedBombIIIDamage = suggestedSimulation?.attack
        ? calculateBombDamage(suggestedSimulation.attack, 3)
        : undefined;

    const currentBombIIDamage = currentSimulation?.attack
        ? calculateBombDamage(currentSimulation.attack, 2)
        : undefined;
    const suggestedBombIIDamage = suggestedSimulation?.attack
        ? calculateBombDamage(suggestedSimulation.attack, 2)
        : undefined;

    return (
        <>
            <div>
                <span className="text-gray-400">Hacking 100% success against security:</span>
                <span className="ml-2">
                    {'<='} {securityFor100Percent}
                    {showComparison &&
                        currentSecurityFor100Percent !== undefined &&
                        suggestedSecurityFor100Percent !== undefined && (
                            <span
                                className={`ml-2 ${
                                    suggestedSecurityFor100Percent > currentSecurityFor100Percent
                                        ? 'text-green-500'
                                        : 'text-red-500'
                                }`}
                            >
                                (
                                {suggestedSecurityFor100Percent > currentSecurityFor100Percent
                                    ? '+'
                                    : ''}
                                {suggestedSecurityFor100Percent - currentSecurityFor100Percent})
                            </span>
                        )}
                </span>
            </div>
            <SimulationStatDisplay
                label="Bomb III Damage"
                value={bombIIIDamage}
                formatValue={(val) => Number(val).toLocaleString()}
                currentValue={currentBombIIIDamage}
                suggestedValue={suggestedBombIIIDamage}
                showComparison={showComparison}
            />
            <SimulationStatDisplay
                label="Bomb II Damage"
                value={bombIIDamage}
                formatValue={(val) => Number(val).toLocaleString()}
                currentValue={currentBombIIDamage}
                suggestedValue={suggestedBombIIDamage}
                showComparison={showComparison}
            />
            <SimulationStatDisplay
                label="Bomb I Damage"
                value={bombIDamage}
                formatValue={(val) => Number(val).toLocaleString()}
            />
            <SimulationStatDisplay
                label="Average Damage"
                value={simulation.averageDamage || 0}
                currentValue={currentSimulation?.averageDamage}
                suggestedValue={suggestedSimulation?.averageDamage}
                showComparison={showComparison}
            />
        </>
    );
};
