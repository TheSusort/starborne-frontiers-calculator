import React, { useState, useEffect } from 'react';
import { GearPiece } from '../../types/gear';
import { SHIP_TYPES, ShipTypeName, GEAR_SLOTS, GearSlotName } from '../../constants';
import {
    analyzeCalibrationPotential,
    CalibrationResult,
    isCalibrationEligible,
} from '../../utils/gear/calibrationCalculator';
import { GearPieceDisplay } from './GearPieceDisplay';
import { Button, ProgressBar } from '../ui';
import { Tabs } from '../ui/layout/Tabs';

interface Props {
    inventory: GearPiece[];
    shipRoles: ShipTypeName[];
    onEdit?: (piece: GearPiece) => void;
    onCalibrate?: (piece: GearPiece) => void;
}

const winnerColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];

export const GearCalibrationAnalysis: React.FC<Props> = ({
    inventory,
    shipRoles,
    onEdit,
    onCalibrate,
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [optimizationProgress, setOptimizationProgress] = useState<{
        current: number;
        total: number;
        percentage: number;
    } | null>(null);
    const [results, setResults] = useState<
        Record<ShipTypeName, Record<GearSlotName | 'all', CalibrationResult[]>>
    >({});
    const [selectedSlots, setSelectedSlots] = useState<Record<ShipTypeName, GearSlotName | 'all'>>(
        Object.fromEntries(shipRoles.map((role) => [role, 'all'])) as Record<
            ShipTypeName,
            GearSlotName | 'all'
        >
    );

    // Filter inventory to only calibration-eligible gear
    const eligibleInventory = inventory.filter(isCalibrationEligible);
    const eligibleCount = eligibleInventory.length;

    // Sync updated gear pieces from inventory into results
    useEffect(() => {
        if (Object.keys(results).length === 0) return;

        // Create a map of current inventory for O(1) lookups
        const inventoryMap = new Map(inventory.map((piece) => [piece.id, piece]));

        let hasChanges = false;
        const updatedResults = { ...results };

        // Iterate through all results and update any gear pieces that have changed
        Object.keys(updatedResults).forEach((role) => {
            const roleResults = updatedResults[role as ShipTypeName];
            Object.keys(roleResults).forEach((slot) => {
                const slotResults = roleResults[slot as GearSlotName | 'all'];

                slotResults.forEach((result, index) => {
                    const updatedPiece = inventoryMap.get(result.piece.id);

                    // Check if the piece exists in inventory and has changed
                    if (
                        updatedPiece &&
                        (updatedPiece.calibration?.shipId !== result.piece.calibration?.shipId ||
                            JSON.stringify(updatedPiece.subStats) !==
                                JSON.stringify(result.piece.subStats))
                    ) {
                        slotResults[index] = {
                            ...result,
                            piece: updatedPiece,
                        };
                        hasChanges = true;
                    }
                });
            });
        });

        if (hasChanges) {
            setResults(updatedResults);
        }
    }, [inventory, results]);

    const processRole = async (
        role: ShipTypeName,
        roleIndex: number,
        newResults: Record<ShipTypeName, Record<GearSlotName | 'all', CalibrationResult[]>>,
        totalSteps: number,
        completedSteps: number
    ): Promise<number> => {
        // Get slot entries - GEAR_SLOTS already excludes implants
        const slotEntries = Object.entries(GEAR_SLOTS);

        // Process 'all' first - show top 6 sorted by current score
        await new Promise((resolve) => setTimeout(resolve, 0));
        const roleResults = analyzeCalibrationPotential(eligibleInventory, role, 6);
        completedSteps++;
        setOptimizationProgress({
            current: completedSteps,
            total: totalSteps,
            percentage: Math.round((completedSteps / totalSteps) * 100),
        });

        // Process each slot individually with yields - show top 6 sorted by current score
        const slotResults: Record<GearSlotName, CalibrationResult[]> = {} as Record<
            GearSlotName,
            CalibrationResult[]
        >;
        for (const [slotName] of slotEntries) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            const slotInventory = eligibleInventory.filter((p) => p.slot === slotName);
            slotResults[slotName as GearSlotName] = analyzeCalibrationPotential(
                slotInventory,
                role,
                6
            );
            completedSteps++;
            setOptimizationProgress({
                current: completedSteps,
                total: totalSteps,
                percentage: Math.round((completedSteps / totalSteps) * 100),
            });
        }

        newResults[role] = {
            all: roleResults,
            ...slotResults,
        };
        setResults({ ...newResults });

        return completedSteps;
    };

    const handleAnalyze = async () => {
        setIsLoading(true);

        // Calculate total steps: for each role, we process 'all' + each gear slot
        const slotsPerRole = 1 + Object.keys(GEAR_SLOTS).length; // 1 for 'all' + 6 gear slots = 7
        const totalSteps = shipRoles.length * slotsPerRole;

        setOptimizationProgress({ current: 0, total: totalSteps, percentage: 0 });

        const newResults: Record<
            ShipTypeName,
            Record<GearSlotName | 'all', CalibrationResult[]>
        > = {};

        // Process each role sequentially with UI updates between each
        let completedSteps = 0;
        for (let i = 0; i < shipRoles.length; i++) {
            const role = shipRoles[i];
            completedSteps = await processRole(role, i, newResults, totalSteps, completedSteps);
        }

        // Small delay to show 100% completion before hiding progress bar
        await new Promise((resolve) => setTimeout(resolve, 500));
        setIsLoading(false);
        setOptimizationProgress(null);
    };

    const handleSlotChange = (role: ShipTypeName, slot: GearSlotName | 'all') => {
        setSelectedSlots((prev) => ({
            ...prev,
            [role]: slot,
        }));
    };

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">
                    Find the best gear pieces to calibrate for maximum stat improvements.
                    {eligibleCount > 0 && (
                        <span className="ml-2 text-cyan-400">
                            ({eligibleCount} eligible piece{eligibleCount !== 1 ? 's' : ''})
                        </span>
                    )}
                </span>
                <Button
                    variant="primary"
                    onClick={handleAnalyze}
                    disabled={isLoading || eligibleCount === 0}
                >
                    {isLoading ? 'Analyzing...' : 'Analyze Calibration'}
                </Button>
            </div>

            <div className="text-sm text-gray-400 space-y-2">
                <p>
                    Click &quot;Analyze Calibration&quot; to find the best gear pieces to calibrate
                    for each ship role. Only level 16 gear with 5-6 stars is eligible for
                    calibration.
                </p>
                <p>
                    <strong>Calibration bonuses:</strong> Flat attack doubles, flat HP/defense +50%,
                    flat hacking/security +10%, flat speed +5. Percentage stats gain +5pp (5★) or
                    +7pp (6★).
                </p>
                <p className="text-yellow-500">
                    ⚠️ Calibrated gear is locked to a specific ship. The bonus only applies when
                    equipped on that ship.
                </p>
            </div>

            {eligibleCount === 0 && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-lg">No calibration-eligible gear found.</p>
                    <p className="text-sm mt-2">
                        Upgrade gear to level 16 with 5 or 6 stars to calibrate it.
                    </p>
                </div>
            )}

            {optimizationProgress && (
                <ProgressBar
                    current={optimizationProgress.current}
                    total={optimizationProgress.total}
                    percentage={optimizationProgress.percentage}
                />
            )}

            {Object.keys(results).length === 0 && !isLoading && eligibleCount > 0 && (
                <div className="text-center py-12 text-gray-400">
                    <p className="text-lg">No analysis results yet.</p>
                    <p className="text-sm mt-2">
                        Click &quot;Analyze Calibration&quot; to find the best calibration
                        candidates.
                    </p>
                </div>
            )}

            {shipRoles.map((role) => {
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
                    <div key={role} className="space-y-4 card">
                        <h3 className="text-lg font-medium">{SHIP_TYPES[role].name}</h3>
                        <span className="text-sm text-gray-400">
                            {SHIP_TYPES[role].description}
                        </span>
                        <Tabs
                            tabs={slotTabs}
                            activeTab={selectedSlot}
                            onChange={(tab) => handleSlotChange(role, tab as GearSlotName | 'all')}
                        />
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {currentResults.map((result, index) => (
                                <div key={result.piece.id} className="space-y-2">
                                    <GearPieceDisplay
                                        gear={result.piece}
                                        mode="manage"
                                        onEdit={onEdit}
                                    />
                                    <div className="text-sm px-4 pb-4 space-y-1">
                                        <div
                                            className={`flex justify-between ${winnerColors[index] || 'text-gray-300'}`}
                                        >
                                            <span>Role Score:</span>
                                            <span>
                                                {Math.round(result.currentScore).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-cyan-400">
                                            <span>Calibration bonus:</span>
                                            <span>
                                                +{Math.round(result.improvement).toLocaleString()}{' '}
                                                (+{Math.round(result.improvementPercentage)}%)
                                            </span>
                                        </div>
                                        {onCalibrate && !result.piece.calibration && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                fullWidth
                                                onClick={() => onCalibrate(result.piece)}
                                            >
                                                Calibrate Gear
                                            </Button>
                                        )}
                                        {result.piece.calibration && (
                                            <div className="text-xs text-cyan-400">
                                                ✓ Already calibrated
                                            </div>
                                        )}
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
