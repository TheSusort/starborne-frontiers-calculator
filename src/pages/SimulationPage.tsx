import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { calculateTotalStats } from '../utils/statsCalculator';
import { useInventory } from '../hooks/useInventory';
import { Button } from '../components/ui';
import { Modal } from '../components/layout/Modal';
import { ShipDisplay } from '../components/ship/ShipDisplay';
import { PageLayout } from '../components/layout/PageLayout';

interface SimulationResult {
    damage: number;
    isCrit: boolean;
}

export const SimulationPage: React.FC = () => {
    const { ships, getShipById } = useShips();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [results, setResults] = useState<SimulationResult[]>([]);
    const [isResultsExpanded, setIsResultsExpanded] = useState(false);
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const { getGearPiece } = useInventory();

    const selectedShip = getShipById(selectedShipId);

    const runSimulation = () => {
        const ship = getShipById(selectedShipId);
        if (!ship) return;

        const stats = calculateTotalStats(ship.baseStats, ship.equipment, getGearPiece, ship.refits, ship.implants);
        const results: SimulationResult[] = [];

        for (let i = 0; i < 100; i++) {
            const isCrit = Math.random() * 100 < (stats.crit || 0);
            let damage = stats.attack;

            if (isCrit) {
                const critMultiplier = 1 + ((stats.critDamage || 0) / 100);
                damage *= critMultiplier;
            }

            results.push({ damage: Math.round(damage), isCrit });
        }

        setResults(results);
    };

    const averageDamage = results.length
        ? Math.round(results.reduce((sum, r) => sum + r.damage, 0) / results.length)
        : 0;
    const topHit = results.length ? Math.max(...results.map(r => r.damage)) : 0;
    const bottomHit = results.length ? Math.min(...results.map(r => r.damage)) : 0;

    return (
        <PageLayout
            title="Attack Simulation"
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
                            {selectedShip ? (
                                'Select another Ship'
                            ) : (
                                'Select a Ship'
                            )}
                        </Button>

                        {selectedShip && (
                            <ShipDisplay ship={selectedShip} />
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
                        Run 100 Simulations
                    </Button>

                    <p className="text-gray-400 text-sm">
                        This simulates 100 attacks with the selected ship and gear. It will only use 100% damage hits, no ship specific attacks are used.
                    </p>
                </div>

                {results.length > 0 && (
                    <div className="space-y-4 bg-dark-lighter p-4 pt-0 rounded ">
                        <h3 className="text-xl font-semibold text-gray-200">Results</h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-dark p-4 rounded">
                                <div className="text-sm text-gray-400">Avg. Hit</div>
                                <div className="text-xl text-white">{averageDamage}</div>
                            </div>
                            <div className="bg-dark p-4 rounded">
                                <div className="text-sm text-gray-400">Highest Hit</div>
                                <div className="text-xl text-white">{topHit}</div>
                            </div>
                            <div className="bg-dark p-4 rounded">
                                <div className="text-sm text-gray-400">Lowest Hit</div>
                                <div className="text-xl text-white">{bottomHit}</div>
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
                                            {results.map((result, index) => (
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