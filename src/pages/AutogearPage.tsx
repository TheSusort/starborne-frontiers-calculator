import React, { useState, useEffect } from 'react';
import { useShips } from '../hooks/useShips';
import { useInventory } from '../hooks/useInventory';
import { GearSuggestion, StatPriority, SetPriority } from '../types/autogear';
import { GearPiece } from '../types/gear';
import { calculateTotalStats } from '../utils/ship/statsCalculator';
import { PageLayout, ProgressBar } from '../components/ui';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { AutogearAlgorithm } from '../utils/autogear/AutogearStrategy';
import { getAutogearStrategy } from '../utils/autogear/getStrategy';
import { runSimulation, SimulationSummary } from '../utils/simulation/simulationCalculator';
import { StatList } from '../components/stats/StatList';
import { GearSlotName, SHIP_TYPES, ShipTypeName } from '../constants';
import { AutogearSettings } from '../components/autogear/AutogearSettings';
import { GearSuggestions } from '../components/autogear/GearSuggestions';
import { SimulationResults } from '../components/simulation/SimulationResults';
import { useNotification } from '../hooks/useNotification';
import { ConfirmModal } from '../components/ui/layout/ConfirmModal';
import { GEAR_SLOTS } from '../constants';
import { useSearchParams } from 'react-router-dom';

export const AutogearPage: React.FC = () => {
    const { getGearPiece, inventory, saveInventory } = useInventory();
    const { getShipById, ships, handleEquipMultipleGear } = useShips();
    const { addNotification } = useNotification();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedShipRole, setSelectedShipRole] = useState<ShipTypeName | null>(null);
    const [statPriorities, setStatPriorities] = useState<StatPriority[]>([]);
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
    const [showSecondaryRequirements, setShowSecondaryRequirements] = useState(false);
    const [searchParams] = useSearchParams();
    const [setPriorities, setSetPriorities] = useState<SetPriority[]>([]);

    // Add effect to handle URL parameters
    useEffect(() => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                setSelectedShipId(shipId);
                setSelectedShipRole(SHIP_TYPES[ship.type].name);
            }
        }
    }, [searchParams, getShipById]);

    const handleAddStatPriority = (priority: StatPriority) => {
        setStatPriorities([...statPriorities, priority]);
    };

    const handleRemoveStatPriority = (index: number) => {
        setStatPriorities(statPriorities.filter((_, i) => i !== index));
    };

    const handleAddSetPriority = (priority: SetPriority) => {
        setSetPriorities([...setPriorities, priority]);
    };

    const handleRemoveSetPriority = (index: number) => {
        setSetPriorities(setPriorities.filter((_, i) => i !== index));
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
                statPriorities,
                availableInventory,
                getGearPiece,
                getEngineeringStatsForShipType,
                selectedShipRole || undefined,
                ignoreEquipped,
                setPriorities
            )
        );

        // Calculate stats using the new suggestions directly
        const currentStats = getCurrentStats();
        const suggestedStats = calculateSuggestedStats(newSuggestions);

        if (currentStats && suggestedStats) {
            setCurrentSimulation(runSimulation(currentStats.final, selectedShipRole));
            setSuggestedSimulation(runSimulation(suggestedStats.final, selectedShipRole));
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
                <div className="space-y-2 ">
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

        const gearAssignments = suggestions.map((suggestion) => ({
            slot: suggestion.slotName as GearSlotName,
            gearId: suggestion.gearId,
        }));

        // Update ships equipment
        handleEquipMultipleGear(selectedShip.id, gearAssignments);

        // Update inventory state
        const newInventory = inventory.map((gear) => {
            const assignment = gearAssignments.find((a) => a.gearId === gear.id);
            if (assignment) {
                return { ...gear, shipId: selectedShip.id };
            }
            // If this gear was on the selected ship but not in new assignments, clear its shipId
            if (gear.shipId === selectedShip.id) {
                const stillEquipped = gearAssignments.some((a) => a.gearId === gear.id);
                if (!stillEquipped) {
                    return { ...gear, shipId: '' };
                }
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
        setShowSecondaryRequirements(false);
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
                    priorities={statPriorities}
                    ignoreEquipped={ignoreEquipped}
                    onIgnoreEquippedChange={setIgnoreEquipped}
                    onShipSelect={(ship) => setSelectedShipId(ship.id)}
                    onRoleSelect={handleRoleChange}
                    onAlgorithmSelect={setSelectedAlgorithm}
                    onAddPriority={handleAddStatPriority}
                    onRemovePriority={handleRemoveStatPriority}
                    onFindOptimalGear={handleAutogear}
                    showSecondaryRequirements={showSecondaryRequirements}
                    onToggleSecondaryRequirements={setShowSecondaryRequirements}
                    setPriorities={setPriorities}
                    onAddSetPriority={handleAddSetPriority}
                    onRemoveSetPriority={handleRemoveSetPriority}
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
                    <div className="col-span-2 p-4 bg-dark">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ">
                    <StatList stats={currentStats.final} title="Current Stats" className="p-4" />
                    <StatList
                        stats={suggestedStats.final}
                        comparisonStats={currentStats.final}
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

export default AutogearPage;
