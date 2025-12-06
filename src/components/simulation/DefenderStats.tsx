import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SimulationStatDisplay } from './SimulationStatDisplay';
import {
    calculateShieldGenerated,
    calculateHealingOnHit,
} from '../../utils/simulation/simulationStatsCalculations';

interface DefenderStatsProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

export const DefenderStats: React.FC<DefenderStatsProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    const shieldData = calculateShieldGenerated(simulation, currentSimulation, suggestedSimulation);
    const healingData = calculateHealingOnHit(simulation, currentSimulation, suggestedSimulation);

    return (
        <>
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
            <SimulationStatDisplay
                label="Security"
                value={simulation.security || 0}
                currentValue={currentSimulation?.security}
                suggestedValue={suggestedSimulation?.security}
                showComparison={showComparison}
            />
            <SimulationStatDisplay
                label="Rounds Survived"
                value={Math.floor(simulation.survivedRounds || 0)}
                currentValue={currentSimulation?.survivedRounds}
                suggestedValue={suggestedSimulation?.survivedRounds}
                showComparison={showComparison}
            />
            {shieldData.value > 0 && (
                <SimulationStatDisplay
                    label="Shield generated"
                    value={shieldData.value}
                    formatValue={(val) => Number(val).toLocaleString()}
                    currentValue={shieldData.current}
                    suggestedValue={shieldData.suggested}
                    showComparison={showComparison}
                />
            )}
            {healingData.value > 0 && (
                <SimulationStatDisplay
                    label="Healed on hit"
                    value={healingData.value}
                    formatValue={(val) => Number(val).toLocaleString()}
                    currentValue={healingData.current}
                    suggestedValue={healingData.suggested}
                    showComparison={showComparison}
                />
            )}
        </>
    );
};
