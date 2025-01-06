import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { useInventory } from '../hooks/useInventory';
import { GearSuggestion, StatPriority } from '../types/autogear';
import { GearPiece } from '../types/gear';
import { calculateTotalStats } from '../utils/statsCalculator';
import { PageLayout, ProgressBar } from '../components/ui';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { AutogearAlgorithm } from '../utils/autogear/AutogearStrategy';
import { getAutogearStrategy } from '../utils/autogear/getStrategy';
import { runSimulation, SimulationSummary } from '../utils/simulationCalculator';
import { StatList } from '../components/stats/StatList';
import { GearSlotName, ShipTypeName } from '../constants';
import { AutogearSettings } from '../components/autogear/AutogearSettings';
import { GearSuggestions } from '../components/autogear/GearSuggestions';
import { SimulationResults } from '../components/simulation/SimulationResults';
import { useNotification } from '../hooks/useNotification';
import { ConfirmModal } from '../components/ui/layout/ConfirmModal';
import { GEAR_SLOTS } from '../constants';

export const AutogearPage: React.FC = () => {
    const { getGearPiece, inventory, saveInventory } = useInventory();
    const { getShipById, handleEquipGear, ships } = useShips();
    const { addNotification } = useNotification();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedShipRole, setSelectedShipRole] = useState<ShipTypeName | null>(null);
    const [priorities, setPriorities] = useState<StatPriority[]>([]);
    const [suggestions, setSuggestions] = useState<GearSuggestion[]>([]);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [selectedAlgorithm, setSelectedAlgorithm] = useState<AutogearAlgorithm>(
        AutogearAlgorithm.Genetic
    );
    const [currentSimulation, setCurrentSimulation] = useState<SimulationSummary | null>(null);
    const [suggestedSimulation, setSuggestedSimulation] = useState<SimulationSummary | null>(null);
    const [optimizationProgress, setOptimizationProgress] = useState<{
        current: number;
        total: number;
        percentage: number;
    } | null>(null);
    const [ignoreEquipped, setIgnoreEquipped] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [modalMessage, setModalMessage] = useState<React.ReactNode | null>(null);
    const selectedShip = getShipById(selectedShipId);

    const handleAddPriority = (priority: StatPriority) => {
        setPriorities([...priorities, priority]);
    };

    const handleRemovePriority = (index: number) => {
        setPriorities(priorities.filter((_, i) => i !== index));
    };

    const handleAutogear = async () => {
        if (!selectedShip) return;

        setOptimizationProgress(null);
        setSuggestions([]);

        const strategy = getAutogearStrategy(selectedAlgorithm);
        strategy.setProgressCallback(setOptimizationProgress);

        // Filter out gear that's equipped on locked ships, except for gear on the selected ship
        const availableInventory = inventory.filter((gear) => {
            // If the gear is equipped on a ship
            if (gear.shipId) {
                const equippedShip = ships.find((ship) => ship.id === gear.shipId);

                // Include if:
                // 1. It's equipped on the selected ship, OR
                // 2. It's equipped on an unlocked ship
                return (
                    gear.shipId === selectedShip.id ||
                    (equippedShip && !equippedShip.equipmentLocked)
                );
            }

            // Include all unequipped gear
            return true;
        });

        const newSuggestions = await Promise.resolve(
            strategy.findOptimalGear(
                selectedShip,
                priorities,
                availableInventory, // Use filtered inventory
                getGearPiece,
                getEngineeringStatsForShipType,
                selectedShipRole || undefined,
                ignoreEquipped
            )
        );

        // Calculate stats using the new suggestions directly
        const currentStats = getCurrentStats();
        const suggestedStats = calculateSuggestedStats(newSuggestions);

        if (currentStats && suggestedStats) {
            setCurrentSimulation(runSimulation(currentStats, selectedShipRole));
            setSuggestedSimulation(runSimulation(suggestedStats, selectedShipRole));
        }

        setSuggestions(newSuggestions);
    };

    const calculateSuggestedStats = (newSuggestions: GearSuggestion[]) => {
        if (!selectedShip) return null;

        const suggestedEquipment = { ...selectedShip.equipment };
        newSuggestions.forEach((suggestion) => {
            suggestedEquipment[suggestion.slotName] = suggestion.gearId;
        });

        return calculateTotalStats(
            selectedShip.baseStats,
            suggestedEquipment,
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            getEngineeringStatsForShipType(selectedShip.type)
        );
    };

    const handleEquipSuggestions = () => {
        if (!selectedShip) return;

        // Create a list of gear movements
        const gearMovements = suggestions
            .map((suggestion) => {
                const gear = getGearPiece(suggestion.gearId);
                if (gear?.shipId && gear.shipId !== selectedShip.id) {
                    const previousShip = getShipById(gear.shipId);
                    if (previousShip) {
                        return {
                            fromShip: previousShip.name,
                            slot: GEAR_SLOTS[suggestion.slotName].label,
                            toShip: selectedShip.name,
                        };
                    }
                }
                return null;
            })
            .filter((movement): movement is NonNullable<typeof movement> => movement !== null);

        if (gearMovements.length > 0) {
            setShowConfirmModal(true);
            setModalMessage(
                <div className="space-y-2 text-gray-200">
                    <p>The following gear will be moved:</p>
                    <ul className="list-disc pl-4 space-y-1">
                        {gearMovements.map((movement, index) => (
                            <li key={index}>
                                {movement.slot} from{' '}
                                <span className="font-semibold">{movement.fromShip}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-4">Do you want to continue?</p>
                </div>
            );
        } else {
            applyGearSuggestions();
        }
    };

    const applyGearSuggestions = () => {
        if (!selectedShip) return;

        // Create a map to batch all inventory updates
        const inventoryUpdates = new Map<string, string>();

        suggestions.forEach((suggestion) => {
            const { slotName, gearId } = suggestion;

            const gear = getGearPiece(gearId);
            if (gear?.shipId && gear.shipId !== selectedShip.id) {
                const previousShip = getShipById(gear.shipId);
                if (previousShip) {
                    addNotification('info', `Unequipped ${slotName} from ${previousShip.name}`);
                }
            }

            inventoryUpdates.set(gearId, selectedShip.id);
            handleEquipGear(selectedShip.id, slotName as GearSlotName, gearId);
        });

        // Batch update the inventory
        const newInventory = inventory.map((gear) => {
            const newShipId = inventoryUpdates.get(gear.id);
            if (newShipId !== undefined) {
                return { ...gear, shipId: newShipId };
            }
            return gear;
        });

        saveInventory(newInventory);
        addNotification('success', 'Suggested gear equipped successfully');
        setSuggestions([]);
        setOptimizationProgress(null);
        setShowConfirmModal(false);
    };

    const getCurrentStats = () => {
        if (!selectedShip) return null;
        return calculateTotalStats(
            selectedShip.baseStats,
            selectedShip.equipment,
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            getEngineeringStatsForShipType(selectedShip.type)
        );
    };

    const handleRoleChange = (role: ShipTypeName) => {
        setSelectedShipRole(role);
        setCurrentSimulation(null);
        setSuggestedSimulation(null);
    };

    const currentStats = getCurrentStats();
    const suggestedStats = calculateSuggestedStats(suggestions);

    return (
        <PageLayout title="Autogear" description="Find the best gear for your ship.">
            <div className="md:grid md:grid-cols-2 gap-4">
                <AutogearSettings
                    selectedShip={selectedShip || null}
                    selectedShipRole={selectedShipRole}
                    selectedAlgorithm={selectedAlgorithm}
                    priorities={priorities}
                    ignoreEquipped={ignoreEquipped}
                    onIgnoreEquippedChange={setIgnoreEquipped}
                    onShipSelect={(ship) => setSelectedShipId(ship.id)}
                    onRoleSelect={handleRoleChange}
                    onAlgorithmSelect={setSelectedAlgorithm}
                    onAddPriority={handleAddPriority}
                    onRemovePriority={handleRemovePriority}
                    onFindOptimalGear={handleAutogear}
                />

                {suggestions.length > 0 && (
                    <GearSuggestions
                        suggestions={suggestions}
                        getGearPiece={getGearPiece}
                        hoveredGear={hoveredGear}
                        onHover={setHoveredGear}
                        onEquip={handleEquipSuggestions}
                    />
                )}

                {/* Show progress bar for any strategy when optimizing */}
                {optimizationProgress && (
                    <div className="col-span-2 p-4 bg-dark rounded">
                        <ProgressBar
                            current={optimizationProgress.current}
                            total={optimizationProgress.total}
                            percentage={optimizationProgress.percentage}
                        />
                    </div>
                )}
            </div>
            {currentSimulation && suggestedSimulation && suggestions.length > 0 && (
                <SimulationResults
                    currentSimulation={currentSimulation}
                    suggestedSimulation={suggestedSimulation}
                    role={selectedShipRole}
                />
            )}

            {currentStats && suggestedStats && suggestions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-200">
                    <StatList stats={currentStats} title="Current Stats" className="p-4" />
                    <StatList
                        stats={suggestedStats}
                        comparisonStats={currentStats}
                        title="Stats with Suggested Gear"
                        className="p-4"
                    />
                </div>
            )}

            <ConfirmModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onConfirm={applyGearSuggestions}
                title="Move Gear"
                message={modalMessage}
                confirmLabel="Move"
                cancelLabel="Cancel"
            />
        </PageLayout>
    );
};
