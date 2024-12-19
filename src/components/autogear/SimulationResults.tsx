import React from 'react';
import { SimulationSummary } from '../../utils/simulationCalculator';

interface SimulationResultsProps {
    currentSimulation: SimulationSummary;
    suggestedSimulation: SimulationSummary;
}

export const SimulationResults: React.FC<SimulationResultsProps> = ({
    currentSimulation,
    suggestedSimulation,
}) => {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-gray-200">
            <div className="bg-dark p-4 rounded space-y-2">
                <h3 className="text-lg font-semibold">Current Gear Simulation</h3>
                <div className="flex flex-col gap-2">
                    <div>
                        <span className="text-gray-400">Average Damage:</span>
                        <span className="ml-2">{currentSimulation.averageDamage}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Highest Hit:</span>
                        <span className="ml-2">{currentSimulation.highestHit}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Lowest Hit:</span>
                        <span className="ml-2">{currentSimulation.lowestHit}</span>
                    </div>
                </div>
            </div>

            <div className="bg-dark p-4 rounded space-y-2">
                <h3 className="text-lg font-semibold">Suggested Gear Simulation</h3>
                <div className="flex flex-col gap-2">
                    <div>
                        <span className="text-gray-400">Average Damage:</span>
                        <span className="ml-2">
                            {suggestedSimulation.averageDamage}
                            <span className={`ml-2 ${suggestedSimulation.averageDamage > currentSimulation.averageDamage ? 'text-green-500' : 'text-red-500'}`}>
                                ({((suggestedSimulation.averageDamage - currentSimulation.averageDamage) / currentSimulation.averageDamage * 100).toFixed(1)}%)
                            </span>
                        </span>
                    </div>
                    <div>
                        <span className="text-gray-400">Highest Hit:</span>
                        <span className="ml-2">{suggestedSimulation.highestHit}</span>
                    </div>
                    <div>
                        <span className="text-gray-400">Lowest Hit:</span>
                        <span className="ml-2">{suggestedSimulation.lowestHit}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}; 