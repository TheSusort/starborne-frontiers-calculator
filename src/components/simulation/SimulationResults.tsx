import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { GEAR_SETS, ShipTypeName } from '../../constants';
import { ENEMY_COUNT } from '../../constants/simulation';

interface SimulationResultsProps {
    currentSimulation: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    role: ShipTypeName | null;
    alwaysColumn?: boolean;
}

export const SimulationResults: React.FC<SimulationResultsProps> = ({
    currentSimulation,
    suggestedSimulation,
    role,
    alwaysColumn = false,
}) => {
    const renderAttackerStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Average Damage:</span>
                <span className="ml-2">
                    {simulation.averageDamage}
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.averageDamage! > currentSimulation.averageDamage! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.averageDamage! -
                                    currentSimulation.averageDamage!) /
                                    currentSimulation.averageDamage!) *
                                100
                            ).toFixed(1)}
                            %)
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
            {simulation.critRate && (
                <div>
                    <span className="text-gray-400">Crit Rate:</span>
                    <span className="ml-2">{simulation.critRate * 100}%</span>
                </div>
            )}
        </>
    );

    const renderDefenderStats = (simulation: SimulationSummary, isComparison = false) => {
        const shieldGenerated = Math.round(
            ((Math.floor(simulation.survivedRounds || 0) *
                (GEAR_SETS['SHIELD']?.stats[0].value || 0) *
                (simulation.activeSets?.filter((set) => set === 'SHIELD').length || 0)) /
                100) *
                (simulation.hp || 0)
        );
        const currentShieldGenerated = Math.round(
            ((Math.floor(currentSimulation.survivedRounds || 0) *
                (GEAR_SETS['SHIELD']?.stats[0].value || 0) *
                (currentSimulation.activeSets?.filter((set) => set === 'SHIELD').length || 0)) /
                100) *
                (currentSimulation.hp || 0)
        );
        const suggestedShieldGenerated = Math.round(
            ((Math.floor(suggestedSimulation?.survivedRounds || 0) *
                (GEAR_SETS['SHIELD']?.stats[0].value || 0) *
                (suggestedSimulation?.activeSets?.filter((set) => set === 'SHIELD').length || 0)) /
                100) *
                (suggestedSimulation?.hp || 0)
        );
        const healedOnHit = Math.round(
            (simulation.survivedRounds || 0) * ENEMY_COUNT * (simulation.healingPerHit || 0)
        );
        const currentHealedOnHit = Math.round(
            (currentSimulation.survivedRounds || 0) *
                ENEMY_COUNT *
                (currentSimulation.healingPerHit || 0)
        );
        const suggestedHealedOnHit = Math.round(
            (suggestedSimulation?.survivedRounds || 0) *
                ENEMY_COUNT *
                (suggestedSimulation?.healingPerHit || 0)
        );

        return (
            <>
                <div>
                    <span className="text-gray-400">Effective HP:</span>
                    <span className="ml-2">
                        {simulation.effectiveHP?.toLocaleString()}
                        {isComparison && suggestedSimulation && (
                            <span
                                className={`ml-2 ${suggestedSimulation.effectiveHP! > currentSimulation.effectiveHP! ? 'text-green-500' : 'text-red-500'}`}
                            >
                                (
                                {(
                                    ((suggestedSimulation.effectiveHP! -
                                        currentSimulation.effectiveHP!) /
                                        currentSimulation.effectiveHP!) *
                                    100
                                ).toFixed(1)}
                                %)
                            </span>
                        )}
                    </span>
                </div>
                <div>
                    <span className="text-gray-400">Damage Reduction:</span>
                    <span className="ml-2">
                        {simulation.damageReduction}%
                        {isComparison && suggestedSimulation && (
                            <span
                                className={`ml-2 ${suggestedSimulation.damageReduction! > currentSimulation.damageReduction! ? 'text-green-500' : 'text-red-500'}`}
                            >
                                (
                                {(
                                    suggestedSimulation.damageReduction! -
                                    currentSimulation.damageReduction!
                                ).toFixed(1)}
                                %)
                            </span>
                        )}
                    </span>
                </div>
                <div>
                    <span className="text-gray-400">Rounds Survived:</span>
                    <span className="ml-2">
                        {Math.floor(simulation.survivedRounds!)}
                        {isComparison && suggestedSimulation && (
                            <span
                                className={`ml-2 ${suggestedSimulation.survivedRounds! > currentSimulation.survivedRounds! ? 'text-green-500' : 'text-red-500'}`}
                            >
                                (
                                {(
                                    ((suggestedSimulation.survivedRounds! -
                                        currentSimulation.survivedRounds!) /
                                        currentSimulation.survivedRounds!) *
                                    100
                                ).toFixed(1)}
                                %)
                            </span>
                        )}
                    </span>
                </div>
                {shieldGenerated > 0 && (
                    <div>
                        <span className="text-gray-400">Shield generated:</span>
                        <span className="ml-2">
                            {shieldGenerated.toLocaleString()}
                            {isComparison && suggestedSimulation && (
                                <span
                                    className={`ml-2 ${suggestedShieldGenerated! > currentShieldGenerated! ? 'text-green-500' : 'text-red-500'}`}
                                >
                                    (
                                    {(
                                        ((suggestedShieldGenerated! - currentShieldGenerated!) /
                                            currentShieldGenerated!) *
                                        100
                                    ).toFixed(1)}
                                    %)
                                </span>
                            )}
                        </span>
                    </div>
                )}
                {healedOnHit > 0 && (
                    <div>
                        <span className="text-gray-400">Healed on hit:</span>
                        <span className="ml-2">
                            {healedOnHit.toLocaleString()}
                            {isComparison && suggestedSimulation && (
                                <span
                                    className={`ml-2 ${suggestedHealedOnHit! > currentHealedOnHit! ? 'text-green-500' : 'text-red-500'}`}
                                >
                                    (
                                    {(
                                        ((suggestedHealedOnHit! - currentHealedOnHit!) /
                                            currentHealedOnHit!) *
                                        100
                                    ).toFixed(1)}
                                    %)
                                </span>
                            )}
                        </span>
                    </div>
                )}
            </>
        );
    };

    const renderDebufferStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Hack Success Rate:</span>
                <span className="ml-2">
                    {simulation.hackSuccessRate}%
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.hackSuccessRate! > currentSimulation.hackSuccessRate! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.hackSuccessRate! -
                                    currentSimulation.hackSuccessRate!) /
                                    currentSimulation.hackSuccessRate!) *
                                100
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Average Damage:</span>
                <span className="ml-2">
                    {simulation.averageDamage}
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.averageDamage! > currentSimulation.averageDamage! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.averageDamage! -
                                    currentSimulation.averageDamage!) /
                                    currentSimulation.averageDamage!) *
                                100
                            ).toFixed(1)}
                            %)
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
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.averageHealing! > currentSimulation.averageHealing! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.averageHealing! -
                                    currentSimulation.averageHealing!) /
                                    currentSimulation.averageHealing!) *
                                100
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Highest Heal:</span>
                <span className="ml-2">
                    {simulation.highestHeal?.toLocaleString()}
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.highestHeal! > currentSimulation.highestHeal! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.highestHeal! -
                                    currentSimulation.highestHeal!) /
                                    currentSimulation.highestHeal!) *
                                100
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Lowest Heal:</span>
                <span className="ml-2">
                    {simulation.lowestHeal?.toLocaleString()}
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.lowestHeal! > currentSimulation.lowestHeal! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.lowestHeal! - currentSimulation.lowestHeal!) /
                                    currentSimulation.lowestHeal!) *
                                100
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    const renderSupporterBufferStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Boost Set:</span>
                <span
                    className={`ml-2 ${
                        simulation.activeSets?.includes('BOOST') ? 'text-green-500' : 'text-red-500'
                    }`}
                >
                    {simulation.activeSets?.includes('BOOST') ? 'Active' : 'Inactive'}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Speed:</span>
                <span className="ml-2">{simulation.speed}</span>
            </div>
            <div>
                <span className="text-gray-400">Effective HP:</span>
                <span className="ml-2">
                    {simulation.effectiveHP?.toLocaleString()}
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.effectiveHP! > currentSimulation.effectiveHP! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.effectiveHP! -
                                    currentSimulation.effectiveHP!) /
                                    currentSimulation.effectiveHP!) *
                                100
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Damage Reduction:</span>
                <span className="ml-2">
                    {simulation.damageReduction}%
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.damageReduction! > currentSimulation.damageReduction! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                suggestedSimulation.damageReduction! -
                                currentSimulation.damageReduction!
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    const renderSupporterOffensiveStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">Boost Set:</span>
                <span
                    className={`ml-2 ${
                        simulation.activeSets?.includes('BOOST') ? 'text-green-500' : 'text-red-500'
                    }`}
                >
                    {simulation.activeSets?.includes('BOOST') ? 'Active' : 'Inactive'}
                </span>
            </div>
            <div>
                <span className="text-gray-400">Speed:</span>
                <span className="ml-2">{simulation.speed}</span>
                {isComparison && suggestedSimulation && (
                    <span
                        className={`ml-2 ${suggestedSimulation.speed! > currentSimulation.speed! ? 'text-green-500' : 'text-red-500'}`}
                    >
                        ({(suggestedSimulation.speed! - currentSimulation.speed!).toFixed(1)}%)
                    </span>
                )}
            </div>
            <div>
                <span className="text-gray-400">Attack:</span>
                <span className="ml-2">
                    {simulation.attack}
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.attack! > currentSimulation.attack! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.attack! - currentSimulation.attack!) /
                                    currentSimulation.attack!) *
                                100
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    const renderSupporterShieldStats = (simulation: SimulationSummary, isComparison = false) => (
        <>
            <div>
                <span className="text-gray-400">HP:</span>
                <span className="ml-2">
                    {Math.round(simulation.hp || 0).toLocaleString()}
                    {isComparison && suggestedSimulation && (
                        <span
                            className={`ml-2 ${suggestedSimulation.hp! > currentSimulation.hp! ? 'text-green-500' : 'text-red-500'}`}
                        >
                            (
                            {(
                                ((suggestedSimulation.hp! - currentSimulation.hp!) /
                                    currentSimulation.hp!) *
                                100
                            ).toFixed(1)}
                            %)
                        </span>
                    )}
                </span>
            </div>
        </>
    );

    const renderStats = (simulation: SimulationSummary, isComparison = false) => {
        switch (role) {
            case 'DEFENDER':
            case 'DEFENDER_SECURITY':
                return renderDefenderStats(simulation, isComparison);
            case 'DEBUFFER':
            case 'DEBUFFER_DEFENSIVE':
            case 'DEBUFFER_BOMBER':
                return renderDebufferStats(simulation, isComparison);
            case 'SUPPORTER':
                return renderSupporterStats(simulation, isComparison);
            case 'SUPPORTER_BUFFER':
                return renderSupporterBufferStats(simulation, isComparison);
            case 'SUPPORTER_OFFENSIVE':
                return renderSupporterOffensiveStats(simulation, isComparison);
            case 'SUPPORTER_SHIELD':
                return renderSupporterShieldStats(simulation, isComparison);
            default:
                return renderAttackerStats(simulation, isComparison);
        }
    };

    return (
        <div
            className={`grid grid-cols-1 ${
                suggestedSimulation && !alwaysColumn ? 'md:grid-cols-2' : ''
            } gap-4 mt-4 `}
        >
            <div>
                <div className="card space-y-2">
                    <h3 className="text-lg font-semibold">Current Configuration</h3>
                    <div className="flex flex-col gap-2">{renderStats(currentSimulation)}</div>
                </div>
            </div>
            {suggestedSimulation && (
                <div>
                    <div className="card space-y-2">
                        <h3 className="text-lg font-semibold">Suggested Configuration</h3>
                        <div className="flex flex-col gap-2">
                            {renderStats(suggestedSimulation, true)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
