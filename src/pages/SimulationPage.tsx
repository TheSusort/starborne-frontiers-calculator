import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { calculateTotalStats } from '../utils/statsCalculator';
import { useInventory } from '../hooks/useInventory';
import { Button } from '../components/ui';
import { Modal } from '../components/layout/Modal';
import { ShipDisplay } from '../components/ship/ShipDisplay';
import { PageLayout } from '../components/layout/PageLayout';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { runDamageSimulation, SimulationSummary } from '../utils/simulationCalculator';

const SIMULATION_ITERATIONS = 500;

export const SimulationPage: React.FC = () => {
    const { ships, getShipById } = useShips();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [isResultsExpanded, setIsResultsExpanded] = useState(false);
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [simulation, setSimulation] = useState<SimulationSummary | null>(null);

    const selectedShip = getShipById(selectedShipId);

    const runSimulation = () => {
        const ship = getShipById(selectedShipId);
        if (!ship) return;

        const stats = calculateTotalStats(
            ship.baseStats,
            ship.equipment,
            getGearPiece,
            ship.refits,
            ship.implants,
            getEngineeringStatsForShipType(ship.type)
        );

        const simulationResults = runDamageSimulation(stats, SIMULATION_ITERATIONS);
        setSimulation(simulationResults);
    };

    return (
        <PageLayout
            title="Attack Simulation"
            description="Simulate attacks with your ships and gear."
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-6">
                    <h3 className="text-xl font-bold text-gray-200">Settings</h3>
                    <div className="space-y-4">
                        <Button
                            variant="secondary"
                            onClick={() => setIsShipModalOpen(true)}
                            fullWidth
                        >
                            {selectedShip ? 'Select another Ship' : 'Select a Ship'}
                        </Button>

                        {selectedShip && (
                            <ShipDisplay ship={selectedShip} variant="compact" />
                        )}

                        <Modal
                            isOpen={isShipModalOpen}
                            onClose={() => setIsShipModalOpen(false)}
                            title="Select a Ship"
                        >
                            <div className="grid grid-cols-1 gap-2">
                                {ships.map(ship => (
                                    <ShipDisplay
                                        key={ship.id}
                                        ship={ship}
                                        variant="compact"
                                        selected={selectedShipId === ship.id}
                                        onClick={() => {
                                            setSelectedShipId(ship.id);
                                            setIsShipModalOpen(false);
                                        }}
                                    />
                                ))}
                            </div>
                        </Modal>
                    </div>

                    <Button
                        variant="primary"
                        onClick={runSimulation}
                        disabled={!selectedShipId}
                        fullWidth
                    >
                        Run {SIMULATION_ITERATIONS} Simulation Attacks
                    </Button>

                    <p className="text-gray-400 text-sm">
                        This simulates {SIMULATION_ITERATIONS} attacks with the selected ship and gear.
                        It will only use 100% damage hits, no ship specific attacks are used.
                    </p>
                </div>

                {simulation && (
                    <div className="space-y-4 bg-dark-lighter p-4 rounded">
                        <h3 className="text-xl font-semibold text-gray-200">Results</h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-dark p-4 rounded">
                                <div className="text-sm text-gray-400">Avg. Hit</div>
                                <div className="text-xl text-gray-200">{simulation.averageDamage}</div>
                            </div>
                            <div className="bg-dark p-4 rounded">
                                <div className="text-sm text-gray-400">Highest Hit</div>
                                <div className="text-xl text-gray-200">{simulation.highestHit}</div>
                            </div>
                            <div className="bg-dark p-4 rounded">
                                <div className="text-sm text-gray-400">Lowest Hit</div>
                                <div className="text-xl text-gray-200">{simulation.lowestHit}</div>
                            </div>
                        </div>

                        <div>
                            <Button
                                variant="secondary"
                                onClick={() => setIsResultsExpanded(!isResultsExpanded)}
                            >
                                {isResultsExpanded ? 'Hide' : 'Show'} Detailed Results
                            </Button>

                            {isResultsExpanded && (
                                <div className="mt-2 max-h-80 overflow-y-auto bg-dark">
                                    <table className="w-full text-sm text-gray-300">
                                        <thead>
                                            <tr className="text-left">
                                                <th className="p-2">Hit #</th>
                                                <th className="p-2">Damage</th>
                                                <th className="p-2">Critical</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {simulation.results.map((result, index) => (
                                                <tr key={index} className="border-t border-dark-border">
                                                    <td className="p-2">{index + 1}</td>
                                                    <td className="p-2">{result.damage}</td>
                                                    <td className="p-2">
                                                        {result.isCrit && (
                                                            <span className="text-yellow-500">CRIT!</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </PageLayout>
    );
};