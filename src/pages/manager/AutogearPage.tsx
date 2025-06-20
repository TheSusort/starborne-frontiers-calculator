import React, { useState, useEffect } from 'react';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useAutogearConfig } from '../../contexts/AutogearConfigContext';
import { GearSuggestion, StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { GearPiece } from '../../types/gear';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { PageLayout, ProgressBar } from '../../components/ui';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';
import { getAutogearStrategy } from '../../utils/autogear/getStrategy';
import { runSimulation, SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { StatList } from '../../components/stats/StatList';
import { GEAR_SETS, GearSlotName, ShipTypeName } from '../../constants';
import { AutogearSettings } from '../../components/autogear/AutogearSettings';
import { GearSuggestions } from '../../components/autogear/GearSuggestions';
import { SimulationResults } from '../../components/simulation/SimulationResults';
import { useNotification } from '../../hooks/useNotification';
import { ConfirmModal } from '../../components/ui/layout/ConfirmModal';
import { GEAR_SLOTS } from '../../constants';
import { useSearchParams } from 'react-router-dom';
import { Ship } from '../../types/ship';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { BaseStats } from '../../types/stats';
import { useGearUpgrades } from '../../hooks/useGearUpgrades';
import { performanceTracker } from '../../utils/autogear/performanceTimer';

interface UnmetPriority {
    stat: string;
    current: number;
    target: number;
    type: 'min' | 'max';
}

export const AutogearPage: React.FC = () => {
    // Helper functions (before hooks)
    const getSuggestedEquipment = (suggestions: GearSuggestion[], ship: Ship | null) => {
        if (!ship) return {};
        const equipment = { ...ship.equipment };
        suggestions.forEach((suggestion) => {
            equipment[suggestion.slotName] = suggestion.gearId;
        });
        return equipment;
    };

    // All hooks
    const { getGearPiece, inventory } = useInventory();
    const { getUpgradedGearPiece } = useGearUpgrades();
    const { getShipById, equipMultipleGear, getShipFromGearId, lockEquipment } = useShips();
    const { addNotification } = useNotification();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [searchParams] = useSearchParams();
    const { getConfig, saveConfig, resetConfig } = useAutogearConfig();

    // useState hooks
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedShipRole, setSelectedShipRole] = useState<ShipTypeName | null>('ATTACKER');
    const [statPriorities, setStatPriorities] = useState<StatPriority[]>([]);
    const [suggestions, setSuggestions] = useState<GearSuggestion[]>([]);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [setPriorities, setSetPriorities] = useState<SetPriority[]>([]);
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
    const [showSecondaryRequirements, setShowSecondaryRequirements] = useState(false);
    const [ignoreUnleveled, setIgnoreUnleveled] = useState(true);
    const [statBonuses, setStatBonuses] = useState<StatBonus[]>([]);
    const [useUpgradedStats, setUseUpgradedStats] = useState(false);

    // Derived state
    const selectedShip = getShipById(selectedShipId);

    // useEffect hooks
    useEffect(() => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                setSelectedShipId(shipId);
                setSelectedShipRole(ship.type);
            }
        }
    }, [searchParams, getShipById]);

    // Load saved config when ship is selected
    useEffect(() => {
        if (selectedShipId) {
            const savedConfig = getConfig(selectedShipId);
            if (savedConfig) {
                setSelectedShipRole(savedConfig.shipRole);
                setStatPriorities(savedConfig.statPriorities);
                setSetPriorities(savedConfig.setPriorities);
                setStatBonuses(savedConfig.statBonuses);
                setIgnoreEquipped(savedConfig.ignoreEquipped);
                setIgnoreUnleveled(savedConfig.ignoreUnleveled);
                setUseUpgradedStats(savedConfig.useUpgradedStats);
                setSelectedAlgorithm(savedConfig.algorithm);
                addNotification('success', 'Loaded saved configuration');
            }
        }
    }, [selectedShipId, getConfig, addNotification]);

    // Helper functions
    const handleAddStatPriority = (priority: StatPriority) => {
        addNotification('success', 'Stat priority added');
        setStatPriorities([...statPriorities, priority]);
    };

    const handleRemoveStatPriority = (index: number) => {
        setStatPriorities(statPriorities.filter((_, i) => i !== index));
    };

    const handleAddSetPriority = (priority: SetPriority) => {
        addNotification('success', 'Set priority added');
        setSetPriorities([...setPriorities, priority]);
    };

    const handleRemoveSetPriority = (index: number) => {
        setSetPriorities(setPriorities.filter((_, i) => i !== index));
    };

    const handleLockEquipment = async (ship: Ship) => {
        await lockEquipment(ship.id, !ship.equipmentLocked);
    };

    const handleAddStatBonus = (bonus: StatBonus) => {
        addNotification('success', 'Stat bonus added');
        setStatBonuses([...statBonuses, bonus]);
    };

    const handleRemoveStatBonus = (index: number) => {
        setStatBonuses(statBonuses.filter((_, i) => i !== index));
    };

    const handleAutogear = async () => {
        if (!selectedShip) return;

        // Uncomment the next line to disable performance tracking entirely
        // performanceTracker.disable();

        performanceTracker.reset();
        performanceTracker.startTimer('TotalAutogear');

        // Save current configuration before running optimization
        performanceTracker.startTimer('SaveConfig');
        const config = {
            shipId: selectedShip.id,
            shipRole: selectedShipRole,
            statPriorities,
            setPriorities,
            statBonuses,
            ignoreEquipped,
            ignoreUnleveled,
            useUpgradedStats,
            algorithm: selectedAlgorithm,
        };
        saveConfig(config);
        performanceTracker.endTimer('SaveConfig');

        setOptimizationProgress(null);
        setSuggestions([]);
        setShowSecondaryRequirements(false);

        const startTime = performance.now();
        // eslint-disable-next-line no-console
        console.log('Starting optimization...');

        const strategy = getAutogearStrategy(selectedAlgorithm);
        strategy.setProgressCallback(setOptimizationProgress);

        // Filter inventory based on both locked ships and ignoreEquipped setting
        performanceTracker.startTimer('FilterInventory');
        const availableInventory = inventory
            .filter((gear) => {
                // Exclude gear with set bonuses that have count set to 0
                const excludedBySetPriority = setPriorities.some(
                    (priority) => priority.setName === gear.setBonus && priority.count === 0
                );
                if (excludedBySetPriority) {
                    return false;
                }

                // If gear is equipped on a ship (either through shipId or getShipFromGearId)
                const equippedShip = getShipFromGearId(gear.id);

                // If ignoreEquipped is true, only include:
                // 1. Not equipped on any ship, OR
                // 2. Equipped on selected ship
                if (ignoreEquipped) {
                    return !equippedShip || equippedShip.id === selectedShip.id;
                }

                // Otherwise, include:
                // 1. Not equipped on any ship, OR
                // 2. Equipped on selected ship, OR
                // 3. Equipped on an unlocked ship
                return (
                    !equippedShip ||
                    equippedShip.id === selectedShip.id ||
                    !equippedShip.equipmentLocked
                );
            })
            .filter((gear) => !ignoreUnleveled || gear.level > 0);
        performanceTracker.endTimer('FilterInventory');

        // eslint-disable-next-line no-console
        console.log(`Available inventory size: ${availableInventory.length}`);

        performanceTracker.startTimer('FindOptimalGear');
        const newSuggestions = await Promise.resolve(
            strategy.findOptimalGear(
                selectedShip,
                statPriorities,
                availableInventory,
                useUpgradedStats ? getUpgradedGearPiece : getGearPiece,
                getEngineeringStatsForShipType,
                selectedShipRole || undefined,
                setPriorities,
                statBonuses
            )
        );
        performanceTracker.endTimer('FindOptimalGear');

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000; // Convert to seconds
        // eslint-disable-next-line no-console
        console.log(`Optimization completed in ${duration.toFixed(2)} seconds`);

        // Create new equipment objects
        performanceTracker.startTimer('PostProcessing');
        const currentEquipment = selectedShip.equipment;
        const suggestedEquipment = getSuggestedEquipment(newSuggestions, selectedShip);

        // Get active sets
        const currentSets = Object.values(currentEquipment).reduce(
            (acc, gearId) => {
                if (!gearId) return acc;
                const gear = getGearPiece(gearId);
                if (!gear?.setBonus) return acc;
                acc[gear.setBonus] = (acc[gear.setBonus] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>
        );

        const suggestedSets = Object.values(suggestedEquipment).reduce(
            (acc, gearId) => {
                if (!gearId) return acc;
                const gear = getGearPiece(gearId);
                if (!gear?.setBonus) return acc;
                acc[gear.setBonus] = (acc[gear.setBonus] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>
        );

        // Calculate stats and run simulations
        const currentStats = getCurrentStats();
        const suggestedStats = calculateSuggestedStats(newSuggestions);

        if (currentStats && suggestedStats) {
            const currentSimulation = runSimulation(
                currentStats.final,
                selectedShipRole,
                Object.entries(currentSets).flatMap(([setName, count]) => {
                    const completeSets = Math.floor(count / (GEAR_SETS[setName]?.minPieces || 2));
                    return Array(completeSets).fill(setName);
                })
            );

            const suggestedSimulation = runSimulation(
                suggestedStats.final,
                selectedShipRole,
                Object.entries(suggestedSets).flatMap(([setName, count]) => {
                    const completeSets = Math.floor(count / (GEAR_SETS[setName]?.minPieces || 2));
                    return Array(completeSets).fill(setName);
                })
            );

            setCurrentSimulation(currentSimulation);
            setSuggestedSimulation(suggestedSimulation);
        }
        performanceTracker.endTimer('PostProcessing');

        setSuggestions(newSuggestions);
        setOptimizationProgress(null);

        performanceTracker.endTimer('TotalAutogear');
        performanceTracker.printSummary();
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
            useUpgradedStats ? getUpgradedGearPiece : getGearPiece,
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
                            fromShip: previousShip,
                            gear: gear,
                            toShip: selectedShip,
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
                                {GEAR_SLOTS[movement.gear.slot].label} from{' '}
                                <span className="font-semibold">{movement.fromShip.name}</span>
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
        equipMultipleGear(selectedShip.id, gearAssignments);

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
            useUpgradedStats ? getUpgradedGearPiece : getGearPiece,
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

    const getUnmetPriorities = (stats: BaseStats): UnmetPriority[] => {
        const unmet: UnmetPriority[] = [];

        statPriorities.forEach((priority) => {
            const currentValue = stats[priority.stat] || 0;

            if (priority.minLimit && currentValue < priority.minLimit) {
                unmet.push({
                    stat: priority.stat,
                    current: currentValue,
                    target: priority.minLimit,
                    type: 'min',
                });
            }

            if (priority.maxLimit && currentValue > priority.maxLimit) {
                unmet.push({
                    stat: priority.stat,
                    current: currentValue,
                    target: priority.maxLimit,
                    type: 'max',
                });
            }
        });

        return unmet;
    };

    const currentStats = getCurrentStats();
    const suggestedStats = calculateSuggestedStats(suggestions);

    // Add reset config handler
    const handleResetConfig = () => {
        if (selectedShipId) {
            resetConfig(selectedShipId);
            setSelectedShipRole('ATTACKER');
            setStatPriorities([]);
            setSetPriorities([]);
            setStatBonuses([]);
            setIgnoreEquipped(true);
            setIgnoreUnleveled(true);
            setUseUpgradedStats(false);
            setSelectedAlgorithm(AutogearAlgorithm.Genetic);
            addNotification('success', 'Reset configuration to defaults');
        }
    };

    return (
        <>
            <Seo {...SEO_CONFIG.autogear} />
            <PageLayout
                title="Autogear"
                description="Find the best gear for your ship. Since the amount of combinations are so high, there's a lot of shortcuts taken to make it faster. The results are not always perfect, as it's based on about 30-40k comparisons, so run it a couple of times to make sure you're getting the best results."
                helpLink="/documentation#autogear"
            >
                <div className="md:grid md:grid-cols-2 gap-4">
                    <AutogearSettings
                        selectedShip={selectedShip || null}
                        selectedShipRole={selectedShipRole}
                        selectedAlgorithm={selectedAlgorithm}
                        priorities={statPriorities}
                        ignoreEquipped={ignoreEquipped}
                        ignoreUnleveled={ignoreUnleveled}
                        showSecondaryRequirements={showSecondaryRequirements}
                        setPriorities={setPriorities}
                        statBonuses={statBonuses}
                        useUpgradedStats={useUpgradedStats}
                        onShipSelect={(ship) => setSelectedShipId(ship.id)}
                        onRoleSelect={handleRoleChange}
                        onAlgorithmSelect={setSelectedAlgorithm}
                        onAddPriority={handleAddStatPriority}
                        onRemovePriority={handleRemoveStatPriority}
                        onFindOptimalGear={handleAutogear}
                        onIgnoreEquippedChange={setIgnoreEquipped}
                        onIgnoreUnleveledChange={setIgnoreUnleveled}
                        onToggleSecondaryRequirements={setShowSecondaryRequirements}
                        onAddSetPriority={handleAddSetPriority}
                        onRemoveSetPriority={handleRemoveSetPriority}
                        onAddStatBonus={handleAddStatBonus}
                        onRemoveStatBonus={handleRemoveStatBonus}
                        onUseUpgradedStatsChange={setUseUpgradedStats}
                        onResetConfig={handleResetConfig}
                    />

                    {suggestions.length > 0 && (
                        <GearSuggestions
                            suggestions={suggestions}
                            getGearPiece={getGearPiece}
                            hoveredGear={hoveredGear}
                            onHover={setHoveredGear}
                            onEquip={handleEquipSuggestions}
                            onLockEquipment={handleLockEquipment}
                            ship={selectedShip}
                            useUpgradedStats={useUpgradedStats}
                        />
                    )}

                    {/* Show progress bar for any strategy when optimizing */}
                    {optimizationProgress && (
                        <ProgressBar
                            current={optimizationProgress.current}
                            total={optimizationProgress.total}
                            percentage={optimizationProgress.percentage}
                        />
                    )}
                </div>

                {suggestedStats && suggestions.length > 0 && (
                    <>
                        {getUnmetPriorities(suggestedStats.final).length > 0 && (
                            <div className="mt-4 p-4 bg-yellow-900/50 border border-yellow-700">
                                <h3 className="text-lg font-semibold text-yellow-200 mb-2">
                                    Unmet Stat Priorities
                                </h3>
                                <p className="text-yellow-100 mb-2">
                                    The suggested gear doesn&apos;t meet all stat priorities, but
                                    was chosen because hitting the priority had a higher negative
                                    impact on the score. Try adjusting the minimum or maximum values
                                    for the stat priorities.
                                </p>
                                <ul className="list-disc pl-4 space-y-1">
                                    {getUnmetPriorities(suggestedStats.final).map(
                                        (priority, index) => (
                                            <li key={index} className="text-yellow-100">
                                                {priority.stat}: {priority.current.toFixed(1)}{' '}
                                                {priority.type === 'min' ? '<' : '>'}{' '}
                                                {priority.target.toFixed(1)}
                                            </li>
                                        )
                                    )}
                                </ul>
                            </div>
                        )}
                    </>
                )}

                {currentSimulation && suggestedSimulation && suggestions.length > 0 && (
                    <SimulationResults
                        currentSimulation={currentSimulation}
                        suggestedSimulation={suggestedSimulation}
                        role={selectedShipRole}
                    />
                )}

                {currentStats && suggestedStats && suggestions.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ">
                        <StatList
                            stats={currentStats.final}
                            title="Current Stats"
                            className="p-4"
                        />
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
        </>
    );
};

export default AutogearPage;
