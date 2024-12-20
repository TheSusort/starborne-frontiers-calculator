import React from 'react';
import { SimulationSummary } from '../../utils/simulationCalculator';
import { ShipTypeName } from '../../constants';

interface SimulationResultsProps {
    currentSimulation: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    role: ShipTypeName | null;
}

export const SimulationResults: React.FC<SimulationResultsProps> = ({
    currentSimulation,
    suggestedSimulation,
    role
}) => {
    const renderAttackerStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Average Damage:</span>
                <span className="ml-2">
                    {simulation.averageDamage}
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.averageDamage! > currentSimulation.averageDamage! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.averageDamage! - currentSimulation.averageDamage!) / currentSimulation.averageDamage! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Highest Hit:</span>
                <span className="ml-2">{simulation.highestHit}</span>
            </div>
            <div>
                <span className="text-gray-400">Lowest Hit:</span>
                <span className="ml-2">{simulation.lowestHit}</span>
            </div>
        </>
    );

    const renderDefenderStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Effective HP:</span>
                <span className="ml-2">
                    {simulation.effectiveHP?.toLocaleString()}
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.effectiveHP! > currentSimulation.effectiveHP! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.effectiveHP! - currentSimulation.effectiveHP!) / currentSimulation.effectiveHP! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Damage Reduction:</span>
                <span className="ml-2">
                    {simulation.damageReduction}%
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.damageReduction! > currentSimulation.damageReduction! ? 'text-green-500' : 'text-red-500'}`}>
                            ({(suggestedSimulation.damageReduction! - currentSimulation.damageReduction!).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Attacks Withstood:</span>
                <span className="ml-2">
                    {simulation.attacksWithstood}
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.attacksWithstood! > currentSimulation.attacksWithstood! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.attacksWithstood! - currentSimulation.attacksWithstood!) / currentSimulation.attacksWithstood! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    const renderDebufferStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Hack Success Rate:</span>
                <span className="ml-2">
                    {simulation.hackSuccessRate}%
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.hackSuccessRate! > currentSimulation.hackSuccessRate! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.hackSuccessRate! - currentSimulation.hackSuccessRate!) / currentSimulation.hackSuccessRate! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Average Damage:</span>
                <span className="ml-2">
                    {simulation.averageDamage}
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.averageDamage! > currentSimulation.averageDamage! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.averageDamage! - currentSimulation.averageDamage!) / currentSimulation.averageDamage! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    const renderSupporterStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Average Healing:</span>
                <span className="ml-2">
                    {simulation.averageHealing?.toLocaleString()}
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.averageHealing! > currentSimulation.averageHealing! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.averageHealing! - currentSimulation.averageHealing!) / currentSimulation.averageHealing! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Highest Heal:</span>
                <span className="ml-2">
                    {simulation.highestHeal?.toLocaleString()}
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.highestHeal! > currentSimulation.highestHeal! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.highestHeal! - currentSimulation.highestHeal!) / currentSimulation.highestHeal! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Lowest Heal:</span>
                <span className="ml-2">
                    {simulation.lowestHeal?.toLocaleString()}
                    {(isComparison && suggestedSimulation) && (
                        <span className={`ml-2 ${suggestedSimulation.lowestHeal! > currentSimulation.lowestHeal! ? 'text-green-500' : 'text-red-500'}`}>
                            ({((suggestedSimulation.lowestHeal! - currentSimulation.lowestHeal!) / currentSimulation.lowestHeal! * 100).toFixed(1)}%)
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    const renderStats = (simulation: SimulationSummary, isComparison = false) => {
        switch (role) {
            case 'Defender':
                return renderDefenderStats(simulation, isComparison);
            case 'Debuffer':
                return renderDebufferStats(simulation, isComparison);
            case 'Supporter':
                return renderSupporterStats(simulation, isComparison);
            default:
                return renderAttackerStats(simulation, isComparison);
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-gray-200">
            <div className="bg-dark p-4 rounded space-y-2">
                <h3 className="text-lg font-semibold">Current Configuration</h3>
                <div className="flex flex-col gap-2">
                    {renderStats(currentSimulation)}
                </div>
            </div>
            {suggestedSimulation && (
                <div className="bg-dark p-4 rounded space-y-2">
                    <h3 className="text-lg font-semibold">Suggested Configuration</h3>
                    <div className="flex flex-col gap-2">
                        {renderStats(suggestedSimulation, true)}
                    </div>
                </div>
            )}
        </div>
    );
};