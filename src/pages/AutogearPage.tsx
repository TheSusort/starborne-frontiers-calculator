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

export const AutogearPage: React.FC = () => {
    const { getGearPiece, inventory, saveInventory } = useInventory();
    const { getShipById, handleEquipGear } = useShips();
    const { addNotification } = useNotification();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedShipRole, setSelectedShipRole] = useState<ShipTypeName | null>(null);
    const [priorities, setPriorities] = useState<StatPriority[]>([]);
    const [suggestions, setSuggestions] = useState<GearSuggestion[]>([]);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [selectedAlgorithm, setSelectedAlgorithm] = useState<AutogearAlgorithm>(
        AutogearAlgorithm.BeamSearch
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

        // Set progress callback for all strategies
        strategy.setProgressCallback(setOptimizationProgress);

        // Always await the strategy result, even if it's not a Promise
        const newSuggestions = await Promise.resolve(
            strategy.findOptimalGear(
                selectedShip,
                priorities,
                inventory,
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

        // Check if any suggested gear is equipped on other ships
        const hasEquippedGear = suggestions.some((suggestion) => {
            const gear = getGearPiece(suggestion.gearId);
            return gear?.shipId && gear.shipId !== selectedShip.id;
        });

        if (hasEquippedGear) {
            setShowConfirmModal(true);
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
                message="Some of the suggested gear is currently equipped on other ships. Would you like to move it?"
                confirmLabel="Move"
                cancelLabel="Cancel"
            />
        </PageLayout>
    );
};
