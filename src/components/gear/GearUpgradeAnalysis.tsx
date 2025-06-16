import React, { useState } from 'react';
import { GearPiece } from '../../types/gear';
import { SHIP_TYPES, ShipTypeName } from '../../constants';
import { analyzePotentialUpgrades } from '../../utils/gear/potentialCalculator';
import { GearPieceDisplay } from './GearPieceDisplay';
import { Button, ProgressBar } from '../ui';
import { useGearUpgrades } from '../../hooks/useGearUpgrades';
import { useNotification } from '../../hooks/useNotification';

interface Props {
    inventory: GearPiece[];
    shipRoles: ShipTypeName[];
}

const winnerColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];

export const GearUpgradeAnalysis: React.FC<Props> = ({ inventory, shipRoles }) => {
    const { simulateUpgrades, clearUpgrades } = useGearUpgrades();
    const { addNotification } = useNotification();
    const [isLoading, setIsLoading] = useState(false);
    const [optimizationProgress, setOptimizationProgress] = useState<{
        current: number;
        total: number;
        percentage: number;
    } | null>(null);
    const [results, setResults] = useState<
        Record<ShipTypeName, ReturnType<typeof analyzePotentialUpgrades>>
    >({});

    const processRole = async (
        role: ShipTypeName,
        index: number,
        newResults: Record<ShipTypeName, ReturnType<typeof analyzePotentialUpgrades>>
    ): Promise<void> => {
        return new Promise((resolve) => {
            // Use setTimeout to allow UI updates
            setTimeout(() => {
                const roleResults = analyzePotentialUpgrades(inventory, role);
                newResults[role] = roleResults;
                setResults({ ...newResults });

                // Update progress
                setOptimizationProgress({
                    current: index + 1,
                    total: shipRoles.length,
                    percentage: Math.round(((index + 1) / shipRoles.length) * 100),
                });

                resolve();
            }, 0);
        });
    };

    const handleSimulateUpgrades = async () => {
        try {
            setIsLoading(true);
            setOptimizationProgress({ current: 0, total: shipRoles.length, percentage: 0 });

            await simulateUpgrades(inventory);
            // Process each role sequentially with UI updates
            for (let i = 0; i < shipRoles.length; i++) {
                const role = shipRoles[i];
                await processRole(role, i, results);
            }

            // After all roles are processed, simulate upgrades
            // Pass the results directly to simulateUpgrades
            addNotification('success', 'Gear upgrades simulated successfully');
        } catch (error) {
            addNotification('error', 'Failed to simulate gear upgrades');
        } finally {
            setIsLoading(false);
            setOptimizationProgress(null);
        }
    };

    const handleClearUpgrades = async () => {
        try {
            await clearUpgrades();
            addNotification('success', 'Gear upgrades cleared');
        } catch (error) {
            addNotification('error', 'Failed to clear gear upgrades');
        }
    };

    const handleAnalyze = async () => {
        setIsLoading(true);
        setOptimizationProgress({ current: 0, total: shipRoles.length, percentage: 0 });
        const newResults: Record<ShipTypeName, ReturnType<typeof analyzePotentialUpgrades>> = {};

        // Process each role sequentially with UI updates between each
        for (let i = 0; i < shipRoles.length; i++) {
            const role = shipRoles[i];
            await processRole(role, i, newResults);
        }

        setIsLoading(false);
        setOptimizationProgress(null);
    };

    // Initial analysis when component mounts
    React.useEffect(() => {
        handleAnalyze();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inventory]);

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Gear Upgrade Analysis (EXPERIMENTAL)</h2>
                <div className="space-x-4">
                    <Button variant="primary" onClick={handleSimulateUpgrades} disabled={isLoading}>
                        Simulate Upgrades
                    </Button>
                    <Button variant="secondary" onClick={handleClearUpgrades} disabled={isLoading}>
                        Clear Simulations
                    </Button>
                </div>
            </div>
            <span className="text-sm text-gray-400">
                This analysis tries to find the 6 best gear upgrades for each ship role, by
                simulating upgrading each piece to 16, 10 different times, and averaging the
                results. The improvement percentages are the average improvement to the role score
                over the current level of the piece. Sorted by the total improvement to the role
                score.
            </span>

            {optimizationProgress && (
                <div className="p-4 bg-dark">
                    <ProgressBar
                        current={optimizationProgress.current}
                        total={optimizationProgress.total}
                        percentage={optimizationProgress.percentage}
                    />
                </div>
            )}

            {shipRoles.map((role) => {
                const roleResults = results[role] || [];

                if (roleResults.length === 0) return null;
                return (
                    <div key={role} className="space-y-4 bg-dark p-4">
                        <h3 className="text-lg font-medium">{SHIP_TYPES[role].name}</h3>
                        <span className="text-sm text-gray-400">
                            {SHIP_TYPES[role].description}
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {roleResults.map((result, index) => (
                                <div key={result.piece.id} className="space-y-2">
                                    <GearPieceDisplay gear={result.piece} />
                                    <div className="text-sm px-4 pb-4">
                                        <div
                                            className={`flex justify-between ${winnerColors[index]}`}
                                        >
                                            <span>Avg. gear improvement:</span>
                                            <span>
                                                {' +'}
                                                {Math.round(
                                                    (result.improvement / result.currentScore) * 100
                                                )}
                                                %
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
