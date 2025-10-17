import React, { useState } from 'react';
import { GearPiece } from '../../types/gear';
import { SHIP_TYPES, ShipTypeName, GEAR_SLOTS, GearSlotName } from '../../constants';
import { analyzePotentialUpgrades } from '../../utils/gear/potentialCalculator';
import { GearPieceDisplay } from './GearPieceDisplay';
import { Button, Input, ProgressBar } from '../ui';
import { useGearUpgrades } from '../../hooks/useGearUpgrades';
import { useNotification } from '../../hooks/useNotification';
import { Tabs } from '../ui/layout/Tabs';

interface Props {
    inventory: GearPiece[];
    shipRoles: ShipTypeName[];
    mode: 'analysis' | 'simulation';
}

const winnerColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];

const RARITY_OPTIONS = [
    { value: 'rare', label: 'Rare', description: 'Rare and above' },
    { value: 'epic', label: 'Epic', description: 'Epic and above' },
    { value: 'legendary', label: 'Legendary', description: 'Legendary only' },
] as const;

export const GearUpgradeAnalysis: React.FC<Props> = ({ inventory, shipRoles, mode }) => {
    const { simulateUpgrades, clearUpgrades } = useGearUpgrades();
    const { addNotification } = useNotification();
    const [isLoading, setIsLoading] = useState(false);
    const [optimizationProgress, setOptimizationProgress] = useState<{
        current: number;
        total: number;
        percentage: number;
    } | null>(null);
    const [selectedRarity, setSelectedRarity] = useState<'rare' | 'epic' | 'legendary'>('rare');
    const [maxLevel, setMaxLevel] = useState<number>(16);
    const [results, setResults] = useState<
        Record<
            ShipTypeName,
            Record<GearSlotName | 'all', ReturnType<typeof analyzePotentialUpgrades>>
        >
    >({});
    const [selectedSlots, setSelectedSlots] = useState<Record<ShipTypeName, GearSlotName | 'all'>>(
        Object.fromEntries(shipRoles.map((role) => [role, 'all'])) as Record<
            ShipTypeName,
            GearSlotName | 'all'
        >
    );

    const processRole = async (
        role: ShipTypeName,
        index: number,
        newResults: Record<
            ShipTypeName,
            Record<GearSlotName | 'all', ReturnType<typeof analyzePotentialUpgrades>>
        >
    ): Promise<void> => {
        return new Promise((resolve) => {
            // Use setTimeout to allow UI updates
            setTimeout(() => {
                // Determine simulation count based on filters
                // Increase runs for higher rarity filters (fewer pieces = more accuracy per piece)
                let simulationCount = 20; // Default for rare+
                if (selectedRarity === 'legendary') {
                    simulationCount = 80; // High accuracy for legendary pieces
                } else if (selectedRarity === 'epic') {
                    simulationCount = 40; // Medium accuracy for epic pieces
                } else if (maxLevel !== 16) {
                    simulationCount = 40; // Increased accuracy when level filter is applied
                }

                // Filter inventory by maxLevel
                const filteredInventory = inventory.filter((piece) => piece.level <= maxLevel);

                // Get overall results
                const roleResults = analyzePotentialUpgrades(
                    filteredInventory,
                    role,
                    6,
                    undefined,
                    selectedRarity,
                    simulationCount
                );

                // Get slot-specific results
                const slotResults = Object.entries(GEAR_SLOTS)
                    .filter(([_, slot]) => !slot.label.includes('Implant'))
                    .reduce(
                        (acc, [slotName, _]) => {
                            acc[slotName] = analyzePotentialUpgrades(
                                filteredInventory,
                                role,
                                6,
                                slotName as GearSlotName,
                                selectedRarity,
                                simulationCount
                            );
                            return acc;
                        },
                        {} as Record<GearSlotName, ReturnType<typeof analyzePotentialUpgrades>>
                    );

                newResults[role] = {
                    all: roleResults,
                    ...slotResults,
                };
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
        const newResults: Record<
            ShipTypeName,
            Record<GearSlotName | 'all', ReturnType<typeof analyzePotentialUpgrades>>
        > = {};

        // Process each role sequentially with UI updates between each
        for (let i = 0; i < shipRoles.length; i++) {
            const role = shipRoles[i];
            await processRole(role, i, newResults);
        }

        setIsLoading(false);
        setOptimizationProgress(null);
    };

    // Removed automatic analysis - now requires manual button click

    const handleSlotChange = (role: ShipTypeName, slot: GearSlotName | 'all') => {
        setSelectedSlots((prev) => ({
            ...prev,
            [role]: slot,
        }));
    };

    return (
        <div className="space-y-8">
            {mode === 'analysis' && (
                <>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-400">
                            Find the best gear pieces to upgrade for maximum stat improvements.
                        </span>
                        <Button variant="primary" onClick={handleAnalyze} disabled={isLoading}>
                            {isLoading ? 'Analyzing...' : 'Analyze Gear'}
                        </Button>
                    </div>
                    <span className="text-sm text-gray-400">
                        Click &quot;Analyze Gear&quot; to find the 6 best gear upgrades for each
                        ship role. The analysis simulates upgrading each piece to level 16 multiple
                        times and averages the results (20 runs for rare+, 40 runs for epic+, 80
                        runs for legendary). Use the rarity and level filters to narrow your search.
                        The improvement percentages show the average improvement to the role score.
                        Results are sorted by total improvement to the role score.
                    </span>
                </>
            )}

            {mode === 'simulation' && (
                <>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-400">
                            Simulate random upgrades on your gear to preview potential stats.
                        </span>
                        <div className="space-x-4">
                            <Button
                                variant="primary"
                                onClick={handleSimulateUpgrades}
                                disabled={isLoading}
                            >
                                Simulate Upgrades
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={handleClearUpgrades}
                                disabled={isLoading}
                            >
                                Clear Simulations
                            </Button>
                        </div>
                    </div>
                    <span className="text-sm text-gray-400">
                        &quot;Simulate Upgrades&quot; will randomly upgrade all your gear pieces,
                        just like in the game. The upgraded stats will be displayed on gear cards
                        throughout the app, with original stats shown in gray. Use &quot;Clear
                        Simulations&quot; to reset all gear back to their actual stats.
                    </span>
                </>
            )}

            {/* Filters - only show for analysis mode */}
            {mode === 'analysis' && (
                <div className="space-x-4 flex">
                    {/* Rarity Filter */}
                    <div className="space-y-1">
                        <p className="text-sm font-medium py-[6px]">Rarity Filter</p>
                        <div className="flex flex-wrap gap-2">
                            {RARITY_OPTIONS.map((option) => (
                                <Button
                                    key={option.value}
                                    onClick={() => setSelectedRarity(option.value)}
                                    className={`text-sm font-medium transition-colors h-auto text-left`}
                                    variant={
                                        selectedRarity === option.value ? 'primary' : 'secondary'
                                    }
                                >
                                    <div>
                                        <div>{option.label}</div>
                                        <div className="text-xs opacity-75">
                                            {option.description}
                                        </div>
                                    </div>
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Level Filter */}
                    <div>
                        <div className="flex items-center gap-3">
                            <Input
                                label="Max Level Filter"
                                type="number"
                                value={maxLevel}
                                onChange={(e) => setMaxLevel(parseInt(e.target.value))}
                                min={0}
                                max={16}
                                helpLabel="Gear with level above this will be excluded"
                                className="py-[26px]"
                            />
                        </div>
                    </div>
                </div>
            )}

            {mode === 'analysis' && optimizationProgress && (
                <ProgressBar
                    current={optimizationProgress.current}
                    total={optimizationProgress.total}
                    percentage={optimizationProgress.percentage}
                />
            )}

            {mode === 'analysis' && Object.keys(results).length === 0 && !isLoading && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-lg">No analysis results yet.</p>
                    <p className="text-sm mt-2">
                        Click &quot;Analyze Gear&quot; to find the best upgrade candidates.
                    </p>
                </div>
            )}

            {mode === 'analysis' &&
                shipRoles.map((role) => {
                    const roleResults = results[role] || {};
                    const selectedSlot = selectedSlots[role] || 'all';
                    const currentResults = roleResults[selectedSlot] || [];

                    if (currentResults.length === 0) return null;

                    const slotTabs = [
                        { id: 'all', label: 'All Slots' },
                        ...Object.entries(GEAR_SLOTS)
                            .filter(([_, slot]) => !slot.label.includes('Implant'))
                            .map(([slotName, slot]) => ({
                                id: slotName,
                                label: slot.label,
                            })),
                    ];

                    return (
                        <div key={role} className="space-y-4 bg-dark p-4">
                            <h3 className="text-lg font-medium">{SHIP_TYPES[role].name}</h3>
                            <span className="text-sm text-gray-400">
                                {SHIP_TYPES[role].description}
                            </span>
                            <Tabs
                                tabs={slotTabs}
                                activeTab={selectedSlot}
                                onChange={(tab) =>
                                    handleSlotChange(role, tab as GearSlotName | 'all')
                                }
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {currentResults.map((result, index) => (
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
                                                        (result.improvement / result.currentScore) *
                                                            100
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
