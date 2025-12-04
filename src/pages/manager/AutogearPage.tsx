import React, { useState, useEffect } from 'react';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useAutogearConfig } from '../../contexts/AutogearConfigContext';
import { GearSuggestion, StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { GearPiece } from '../../types/gear';
import { calculateTotalStats, StatBreakdown } from '../../utils/ship/statsCalculator';
import { Button, PageLayout, ProgressBar, Tabs } from '../../components/ui';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';
import { getAutogearStrategy } from '../../utils/autogear/getStrategy';
import { runSimulation, SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { StatList } from '../../components/stats/StatList';
import { GEAR_SETS, GearSlotName, SHIP_TYPES, ShipTypeName } from '../../constants';
import { AutogearQuickSettings } from '../../components/autogear/AutogearQuickSettings';
import { AutogearSettingsModal } from '../../components/autogear/AutogearSettingsModal';
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
import { useAuth } from '../../contexts/AuthProvider';
import { trackAutogearRun } from '../../services/usageTracking';

interface UnmetPriority {
    stat: string;
    current: number;
    target: number;
    type: 'min' | 'max';
    hardRequirement: boolean;
}

export const AutogearPage: React.FC = () => {
    // Helper functions (before hooks)
    const getSuggestedEquipment = (suggestions: GearSuggestion[], ship: Ship | null) => {
        if (!ship) return {};
        const equipment = { ...ship.equipment };
        suggestions
            .filter((s) => !s.slotName.startsWith('implant_')) // Only gear
            .forEach((suggestion) => {
                equipment[suggestion.slotName] = suggestion.gearId;
            });
        return equipment;
    };

    const getSuggestedImplants = (suggestions: GearSuggestion[], ship: Ship | null) => {
        if (!ship) return {};
        const implants = { ...ship.implants };
        suggestions
            .filter((s) => s.slotName.startsWith('implant_')) // Only implants
            .forEach((suggestion) => {
                implants[suggestion.slotName] = suggestion.gearId;
            });
        return implants;
    };

    // All hooks
    const { getGearPiece, inventory } = useInventory();
    const { getUpgradedGearPiece } = useGearUpgrades();
    const { getShipById, equipMultipleGear, lockEquipment, gearToShipMap, ships, updateShip } =
        useShips();
    const { addNotification } = useNotification();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [searchParams] = useSearchParams();
    const { getConfig, saveConfig, resetConfig } = useAutogearConfig();
    const { user } = useAuth();

    // useState hooks
    const [selectedShips, setSelectedShips] = useState<(Ship | null)[]>([null]);
    const [shipConfigs, setShipConfigs] = useState<
        Record<
            string,
            {
                shipRole: ShipTypeName | null;
                statPriorities: StatPriority[];
                setPriorities: SetPriority[];
                statBonuses: StatBonus[];
                ignoreEquipped: boolean;
                ignoreUnleveled: boolean;
                useUpgradedStats: boolean;
                tryToCompleteSets: boolean;
                selectedAlgorithm: AutogearAlgorithm;
                showSecondaryRequirements: boolean;
                optimizeImplants: boolean;
            }
        >
    >({});
    const [shipResults, setShipResults] = useState<
        Record<
            string,
            {
                suggestions: GearSuggestion[];
                currentSimulation: SimulationSummary | null;
                suggestedSimulation: SimulationSummary | null;
                currentStats: StatBreakdown;
                suggestedStats: StatBreakdown;
            }
        >
    >({});
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [optimizationProgress, setOptimizationProgress] = useState<{
        current: number;
        total: number;
        percentage: number;
        currentShip: {
            name: string;
            index: number;
        };
    } | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [modalMessage, setModalMessage] = useState<React.ReactNode | null>(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [shipSettings, setShipSettings] = useState<Ship | null>(null);
    const [currentEquippingShipId, setCurrentEquippingShipId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<string | null>(null);
    const [hasInitializedFromParams, setHasInitializedFromParams] = useState(false);
    const [isPrinting, setIsPrinting] = useState(false);

    // Helper function to get config for a specific ship
    const getShipConfig = (shipId: string) => {
        const ship = getShipById(shipId);
        const defaultRole = ship?.type || ('ATTACKER' as ShipTypeName);

        return (
            shipConfigs[shipId] || {
                shipRole: defaultRole,
                statPriorities: [],
                setPriorities: [],
                statBonuses: [],
                ignoreEquipped: true,
                ignoreUnleveled: true,
                useUpgradedStats: false,
                tryToCompleteSets: false,
                selectedAlgorithm: AutogearAlgorithm.Genetic,
                showSecondaryRequirements: false,
                optimizeImplants: false,
            }
        );
    };

    // Helper function to update config for a specific ship
    const updateShipConfig = (shipId: string, updates: Partial<(typeof shipConfigs)[string]>) => {
        setShipConfigs((prev) => ({
            ...prev,
            [shipId]: {
                ...getShipConfig(shipId),
                ...updates,
            },
        }));
    };

    // useEffect hooks
    useEffect(() => {
        if (hasInitializedFromParams) return; // Don't run if already initialized

        const shipId = searchParams.get('shipId');

        // Clear search params
        window.history.replaceState({}, '', window.location.pathname);

        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                setSelectedShips([ship]);
                // Load saved config for this ship
                const savedConfig = getConfig(shipId);
                if (savedConfig) {
                    updateShipConfig(shipId, savedConfig);
                    addNotification('success', 'Loaded saved configuration');
                }
            }
        }

        setHasInitializedFromParams(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, getShipById, getConfig, addNotification, hasInitializedFromParams]);

    // Set initial active tab when results are available
    useEffect(() => {
        const shipIds = Object.keys(shipResults);
        if (shipIds.length > 0 && !activeTab) {
            setActiveTab(shipIds[0]);
        }
    }, [shipResults, activeTab]);

    // Refresh selectedShips when ships array changes (e.g., after lock state changes)
    useEffect(() => {
        setSelectedShips((prevSelectedShips) =>
            prevSelectedShips.map((selectedShip) =>
                selectedShip ? getShipById(selectedShip.id) || selectedShip : null
            )
        );
    }, [ships, getShipById]);

    const handleLockEquipment = async (ship: Ship) => {
        await lockEquipment(ship.id, !ship.equipmentLocked);
        addNotification(
            'success',
            `Equipment ${ship.equipmentLocked ? 'unlocked' : 'locked'} for ${ship.name}`
        );
    };

    const handleAutogear = async () => {
        // Filter out null ships and get valid ships
        const validShips = selectedShips.filter((ship): ship is Ship => ship !== null);
        if (validShips.length === 0) return;

        // Uncomment the next line to disable performance tracking entirely
        // performanceTracker.disable();

        performanceTracker.reset();
        performanceTracker.startTimer('TotalAutogear');

        setOptimizationProgress(null);
        setShipResults({});
        setActiveTab(null);

        const startTime = performance.now();
        // eslint-disable-next-line no-console
        console.log('Starting team optimization...');

        // Track used gear across all runs
        const usedGearIds = new Set<string>();
        const allResults: Record<
            string,
            {
                suggestions: GearSuggestion[];
                currentSimulation: SimulationSummary | null;
                suggestedSimulation: SimulationSummary | null;
                currentStats: StatBreakdown;
                suggestedStats: StatBreakdown;
            }
        > = {};

        // Custom progress callback for team autogear
        const teamProgressCallback = (
            progress: { current: number; total: number; percentage: number },
            shipName: string,
            index: number
        ) => {
            setOptimizationProgress({
                ...progress,
                currentShip: {
                    name: shipName,
                    index: index,
                },
            });
        };

        // Run autogear for each ship sequentially
        for (let i = 0; i < validShips.length; i++) {
            const ship = validShips[i];
            const shipConfig = getShipConfig(ship.id);

            // Save current configuration before running optimization
            performanceTracker.startTimer('SaveConfig');
            const config = {
                shipId: ship.id,
                shipRole: shipConfig.shipRole,
                statPriorities: shipConfig.statPriorities,
                setPriorities: shipConfig.setPriorities,
                statBonuses: shipConfig.statBonuses,
                ignoreEquipped: shipConfig.ignoreEquipped,
                ignoreUnleveled: shipConfig.ignoreUnleveled,
                useUpgradedStats: shipConfig.useUpgradedStats,
                algorithm: shipConfig.selectedAlgorithm,
                tryToCompleteSets: shipConfig.tryToCompleteSets,
            };
            saveConfig(config);
            performanceTracker.endTimer('SaveConfig');

            // eslint-disable-next-line no-console
            console.log(
                `Starting optimization for ship ${i + 1}/${validShips.length}: ${ship.name}`
            );

            const strategy = getAutogearStrategy(shipConfig.selectedAlgorithm);

            // Set progress callback for this ship
            strategy.setProgressCallback((progress) =>
                teamProgressCallback(progress, ship.name, i)
            );

            // Filter inventory based on used gear and ship-specific settings
            performanceTracker.startTimer('FilterInventory');
            const availableInventory = inventory
                .filter((gear) => {
                    const isImplant = gear.slot.startsWith('implant_');

                    // Always exclude ultimate implants from optimization
                    if (gear.slot === 'implant_ultimate') {
                        return false;
                    }

                    // If optimizeImplants is false, exclude all implants
                    if (isImplant && !shipConfig.optimizeImplants) {
                        return false;
                    }

                    // Exclude already used gear
                    if (usedGearIds.has(gear.id)) {
                        return false;
                    }

                    // Exclude gear with set bonuses that have count set to 0
                    const excludedBySetPriority = shipConfig.setPriorities.some(
                        (priority) => priority.setName === gear.setBonus && priority.count === 0
                    );
                    if (excludedBySetPriority) {
                        return false;
                    }

                    // If gear is equipped on a ship
                    const shipId = gearToShipMap.get(gear.id);
                    const equippedShip = shipId ? getShipById(shipId) : undefined;

                    // IMPLANTS: Always exclude if equipped on another ship
                    if (isImplant) {
                        return !equippedShip || equippedShip.id === ship.id;
                    }

                    // GEAR: Follow ignoreEquipped setting
                    // If ignoreEquipped is true, only include:
                    // 1. Not equipped on any ship, OR
                    // 2. Equipped on selected ship
                    if (shipConfig.ignoreEquipped) {
                        return !equippedShip || equippedShip.id === ship.id;
                    }

                    // Otherwise, include:
                    // 1. Not equipped on any ship, OR
                    // 2. Equipped on selected ship, OR
                    // 3. Equipped on an unlocked ship
                    return (
                        !equippedShip ||
                        equippedShip.id === ship.id ||
                        !equippedShip.equipmentLocked
                    );
                })
                .filter((gear) => {
                    const isImplant = gear.slot.startsWith('implant_');
                    // Don't apply ignoreUnleveled to implants (they don't have levels)
                    if (isImplant) return true;
                    // For gear, apply the ignoreUnleveled filter
                    return !shipConfig.ignoreUnleveled || gear.level > 0;
                });
            performanceTracker.endTimer('FilterInventory');

            // eslint-disable-next-line no-console
            console.log(`Available inventory size for ${ship.name}: ${availableInventory.length}`);

            performanceTracker.startTimer('FindOptimalGear');
            const newSuggestions = await Promise.resolve(
                strategy.findOptimalGear(
                    ship,
                    shipConfig.statPriorities,
                    availableInventory,
                    shipConfig.useUpgradedStats ? getUpgradedGearPiece : getGearPiece,
                    getEngineeringStatsForShipType,
                    shipConfig.shipRole || undefined,
                    shipConfig.setPriorities,
                    shipConfig.statBonuses,
                    shipConfig.tryToCompleteSets
                )
            );
            performanceTracker.endTimer('FindOptimalGear');

            // Add used gear to the set
            newSuggestions.forEach((suggestion) => {
                usedGearIds.add(suggestion.gearId);
            });

            // Calculate stats and run simulations for this ship
            performanceTracker.startTimer('PostProcessing');
            const currentEquipment = ship.equipment;
            const suggestedEquipment = getSuggestedEquipment(newSuggestions, ship);
            const suggestedImplants = getSuggestedImplants(newSuggestions, ship);

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
            const currentStats = calculateTotalStats(
                ship.baseStats,
                ship.equipment,
                shipConfig.useUpgradedStats ? getUpgradedGearPiece : getGearPiece,
                ship.refits,
                ship.implants,
                getEngineeringStatsForShipType(ship.type)
            );

            const suggestedStats = calculateTotalStats(
                ship.baseStats,
                suggestedEquipment,
                shipConfig.useUpgradedStats ? getUpgradedGearPiece : getGearPiece,
                ship.refits,
                suggestedImplants,
                getEngineeringStatsForShipType(ship.type)
            );

            if (currentStats && suggestedStats) {
                const currentSimulation = runSimulation(
                    currentStats.final,
                    shipConfig.shipRole,
                    Object.entries(currentSets).flatMap(([setName, count]) => {
                        const completeSets = Math.floor(
                            count / (GEAR_SETS[setName]?.minPieces || 2)
                        );
                        return Array(completeSets).fill(setName);
                    })
                );
                const suggestedSimulation = runSimulation(
                    suggestedStats.final,
                    shipConfig.shipRole,
                    Object.entries(suggestedSets).flatMap(([setName, count]) => {
                        const completeSets = Math.floor(
                            count / (GEAR_SETS[setName]?.minPieces || 2)
                        );
                        return Array(completeSets).fill(setName);
                    })
                );

                allResults[ship.id] = {
                    suggestions: newSuggestions,
                    currentSimulation,
                    suggestedSimulation,
                    currentStats,
                    suggestedStats,
                };
            }
            performanceTracker.endTimer('PostProcessing');

            // eslint-disable-next-line no-console
            console.log(`Completed optimization for ${ship.name}`);
        }

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000; // Convert to seconds
        // eslint-disable-next-line no-console
        console.log(`Team optimization completed in ${duration.toFixed(2)} seconds`);

        setShipResults(allResults);
        setOptimizationProgress(null);

        performanceTracker.endTimer('TotalAutogear');
        performanceTracker.printSummary();

        // Track autogear run (for both logged-in and anonymous users)
        trackAutogearRun(user?.id);
    };

    const handleEquipSuggestionsForShip = (shipId: string) => {
        const ship = selectedShips.find((s) => s?.id === shipId);
        if (!ship) return;

        const currentShipResults = shipResults[shipId];
        if (!currentShipResults) return;

        // Create a list of gear movements
        const gearMovements = currentShipResults.suggestions
            .map((suggestion) => {
                const gear = getGearPiece(suggestion.gearId);
                if (gear?.shipId && gear.shipId !== shipId) {
                    const previousShip = getShipById(gear.shipId);
                    if (previousShip) {
                        return {
                            fromShip: previousShip,
                            gear: gear,
                            toShip: ship,
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
            // Store the ship ID for the confirm action
            setCurrentEquippingShipId(shipId);
        } else {
            applyGearSuggestionsForShip(shipId);
        }
    };

    const applyGearSuggestionsForShip = async (shipId: string) => {
        const ship = selectedShips.find((s) => s?.id === shipId);
        if (!ship) return;

        const currentShipResults = shipResults[shipId];
        if (!currentShipResults) return;

        // Separate gear and implant suggestions
        const gearSuggestions = currentShipResults.suggestions.filter(
            (s) => !s.slotName.startsWith('implant_')
        );
        const implantSuggestions = currentShipResults.suggestions.filter((s) =>
            s.slotName.startsWith('implant_')
        );

        // Apply gear updates using equipMultipleGear (handles moving gear from other ships)
        if (gearSuggestions.length > 0) {
            const gearAssignments = gearSuggestions.map((suggestion) => ({
                slot: suggestion.slotName as GearSlotName,
                gearId: suggestion.gearId,
            }));
            await equipMultipleGear(shipId, gearAssignments);
        }

        // Apply implant updates using updateShip (implants don't move between ships)
        if (implantSuggestions.length > 0) {
            const currentShip = getShipById(shipId);
            if (currentShip) {
                const newImplants = { ...currentShip.implants };
                implantSuggestions.forEach((suggestion) => {
                    newImplants[suggestion.slotName as GearSlotName] = suggestion.gearId;
                });
                await updateShip(shipId, { implants: newImplants });
            }
        }

        addNotification('success', `Suggested gear equipped successfully for ${ship.name}`);
        setShowConfirmModal(false);
        setCurrentEquippingShipId(null);
    };

    const getUnmetPriorities = (stats: BaseStats, shipId?: string): UnmetPriority[] => {
        const unmet: UnmetPriority[] = [];
        const targetShipId = shipId || selectedShips[0]?.id || '';

        getShipConfig(targetShipId).statPriorities.forEach((priority) => {
            const currentValue = stats[priority.stat] || 0;

            if (priority.minLimit && currentValue < priority.minLimit) {
                unmet.push({
                    stat: priority.stat,
                    current: currentValue,
                    target: priority.minLimit,
                    type: 'min',
                    hardRequirement: priority.hardRequirement || false,
                });
            }

            if (priority.maxLimit && currentValue > priority.maxLimit) {
                unmet.push({
                    stat: priority.stat,
                    current: currentValue,
                    target: priority.maxLimit,
                    type: 'max',
                    hardRequirement: priority.hardRequirement || false,
                });
            }
        });

        return unmet;
    };

    // Multiple ship handlers
    const handleShipSelect = (ship: Ship, index: number) => {
        const newShips = [...selectedShips];
        newShips[index] = ship;
        setSelectedShips(newShips);

        // Load saved config for this ship if it exists
        const savedConfig = getConfig(ship.id);
        if (savedConfig) {
            updateShipConfig(ship.id, savedConfig);
        }
    };

    const handleAddShip = () => {
        // Add a placeholder that will be replaced when user selects a ship
        setSelectedShips([...selectedShips, null]); // Will be replaced when user selects a ship
    };

    const handleRemoveShip = (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
        event.stopPropagation();
        setSelectedShips(selectedShips.filter((_, i) => i !== index));
    };

    const handlePrint = () => {
        setIsPrinting(true);
        // Use setTimeout to ensure state update before print
        setTimeout(() => {
            window.print();
            // Reset printing state after print dialog closes
            setTimeout(() => setIsPrinting(false), 1000);
        }, 100);
    };

    return (
        <>
            <Seo {...SEO_CONFIG.autogear} />
            <PageLayout
                title="Autogear"
                description="Find the best gear for your ship. Since the amount of combinations are so high, there's a lot of shortcuts taken to make it faster. The results are not always perfect, as it's based on about 30-40k comparisons, so run it a couple of times to make sure you're getting the best results."
                helpLink="/documentation#autogear"
            >
                <div className="md:flex gap-4">
                    <div className="flex-1 print:hidden">
                        <AutogearQuickSettings
                            selectedShips={selectedShips}
                            onShipSelect={handleShipSelect}
                            onAddShip={handleAddShip}
                            onRemoveShip={handleRemoveShip}
                            onOpenSettings={(
                                event: React.MouseEvent<HTMLButtonElement>,
                                index: number
                            ) => {
                                event.stopPropagation();
                                setShipSettings(selectedShips[index]);
                                setShowSettingsModal(true);
                            }}
                            onFindOptimalGear={handleAutogear}
                            getShipConfig={getShipConfig}
                        />
                    </div>

                    {/* Show progress bar for any strategy when optimizing */}
                    {optimizationProgress && (
                        <ProgressBar
                            current={optimizationProgress.current}
                            total={optimizationProgress.total}
                            percentage={optimizationProgress.percentage}
                            label={`Optimizing: ${optimizationProgress.currentShip.name} (${optimizationProgress.currentShip.index + 1}/${selectedShips.length})`}
                        />
                    )}

                    <div className="flex-1">
                        {/* Show gear suggestions for all ships */}
                        {Object.keys(shipResults).length > 0 && (
                            <div className="space-y-4">
                                {Object.entries(shipResults).map(([shipId, results]) => {
                                    const ship = selectedShips.find((s) => s?.id === shipId);
                                    if (!ship || !results.suggestions.length) return null;

                                    const shipConfig = getShipConfig(shipId);
                                    const shouldShowSuggestions = !getUnmetPriorities(
                                        results.suggestedStats?.final || {},
                                        shipId
                                    ).some((priority) => priority.hardRequirement);

                                    return (
                                        <div key={shipId} className="space-y-4">
                                            {shouldShowSuggestions && (
                                                <div className="gear-suggestions">
                                                    <GearSuggestions
                                                        suggestions={results.suggestions}
                                                        getGearPiece={getGearPiece}
                                                        hoveredGear={hoveredGear}
                                                        onHover={setHoveredGear}
                                                        onEquip={() =>
                                                            handleEquipSuggestionsForShip(shipId)
                                                        }
                                                        onLockEquipment={handleLockEquipment}
                                                        ship={ship}
                                                        useUpgradedStats={
                                                            shipConfig.useUpgradedStats
                                                        }
                                                        isPrinting={isPrinting}
                                                        optimizeImplants={
                                                            shipConfig.optimizeImplants
                                                        }
                                                    />
                                                </div>
                                            )}

                                            {/* Show unmet priorities warning */}
                                            {getUnmetPriorities(
                                                results.suggestedStats?.final || {},
                                                shipId
                                            ).length > 0 && (
                                                <div className="p-4 bg-yellow-900/50 border border-yellow-700">
                                                    <h4 className="text-lg font-semibold text-yellow-200 mb-2">
                                                        Unmet Stat Priorities
                                                    </h4>
                                                    {getUnmetPriorities(
                                                        results.suggestedStats?.final || {},
                                                        shipId
                                                    ).some(
                                                        (priority) => priority.hardRequirement
                                                    ) ? (
                                                        <p className="text-yellow-100 mb-2">
                                                            Some stat priorities are marked as hard
                                                            requirements, which means that the gear
                                                            combinations that don&apos;t meet them
                                                            will be completely excluded from
                                                            results. It wasn&apos;t found this
                                                            round, so it might be unachievable. Try
                                                            running it again, or adjust the stat
                                                            limits.
                                                        </p>
                                                    ) : (
                                                        <p className="text-yellow-100 mb-2">
                                                            The suggested gear doesn&apos;t meet all
                                                            stat priorities, but was chosen because
                                                            hitting the priority had a higher
                                                            negative impact on the score. Try
                                                            adjusting the minimum or maximum values
                                                            for the stat priorities.
                                                        </p>
                                                    )}

                                                    <ul className="list-disc pl-4 space-y-1">
                                                        {getUnmetPriorities(
                                                            results.suggestedStats?.final || {},
                                                            shipId
                                                        ).map((priority, index) => (
                                                            <li
                                                                key={index}
                                                                className="text-yellow-100"
                                                            >
                                                                {priority.stat}:{' '}
                                                                {priority.current.toFixed(1)}{' '}
                                                                {priority.type === 'min'
                                                                    ? '<'
                                                                    : '>'}{' '}
                                                                {priority.target.toFixed(1)}
                                                                {priority.hardRequirement &&
                                                                    ' (HARD)'}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Detailed Results Tabs */}
                {Object.keys(shipResults).length > 0 && (
                    <div>
                        {/* Show tabs only when not printing */}
                        {!isPrinting && (
                            <Tabs
                                tabs={Object.keys(shipResults)
                                    .map((shipId) => {
                                        const ship = selectedShips.find((s) => s?.id === shipId);
                                        return ship ? { id: shipId, label: ship.name } : null;
                                    })
                                    .filter(
                                        (tab): tab is { id: string; label: string } => tab !== null
                                    )}
                                activeTab={activeTab || ''}
                                onChange={(tabId: string) => setActiveTab(tabId)}
                            />
                        )}

                        {/* Tab Content */}
                        <div className="mt-4">
                            {Object.entries(shipResults).map(([shipId, results]) => {
                                const ship = selectedShips.find((s) => s?.id === shipId);
                                if (!ship || !results.suggestions.length) return null;

                                const shipConfig = getShipConfig(shipId);
                                const shouldShowSuggestions = !getUnmetPriorities(
                                    results.suggestedStats?.final || {},
                                    shipId
                                ).some((priority) => priority.hardRequirement);

                                // When printing, show all ships; otherwise only show active tab
                                if (!isPrinting && activeTab !== shipId) return null;

                                return (
                                    <div
                                        key={shipId}
                                        className={`space-y-6 ship-results ${isPrinting ? 'mb-8 print:mb-8' : ''}`}
                                    >
                                        {/* Ship Header for Print */}
                                        {isPrinting && (
                                            <div className="print:block hidden">
                                                <h3 className="text-xl font-bold border-b border-gray-300 pb-2 mb-4">
                                                    {ship.name} - Detailed Results
                                                </h3>
                                            </div>
                                        )}

                                        {/* Simulation Results */}
                                        {results.currentSimulation &&
                                            results.suggestedSimulation &&
                                            shouldShowSuggestions && (
                                                <div>
                                                    <h4 className="text-lg font-semibold mb-4">
                                                        Simulation Results (
                                                        {
                                                            SHIP_TYPES[shipConfig.shipRole || '']
                                                                ?.name
                                                        }
                                                        )
                                                    </h4>
                                                    <SimulationResults
                                                        currentSimulation={
                                                            results.currentSimulation
                                                        }
                                                        suggestedSimulation={
                                                            results.suggestedSimulation
                                                        }
                                                        role={shipConfig.shipRole}
                                                    />
                                                </div>
                                            )}

                                        {/* Stat Lists */}
                                        {results.currentStats &&
                                            results.suggestedStats &&
                                            shouldShowSuggestions && (
                                                <div>
                                                    <h4 className="text-lg font-semibold mb-4">
                                                        Stat Comparison
                                                    </h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <StatList
                                                            stats={results.currentStats.final}
                                                            title="Current Stats"
                                                        />
                                                        <StatList
                                                            stats={results.suggestedStats.final}
                                                            comparisonStats={
                                                                results.currentStats.final
                                                            }
                                                            title="Stats with Suggested Gear"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Print Button */}
                {Object.keys(shipResults).length > 0 && (
                    <div className="mt-6 print:hidden">
                        <Button onClick={handlePrint} variant="secondary">
                            Print Results
                        </Button>
                    </div>
                )}

                <AutogearSettingsModal
                    isOpen={showSettingsModal}
                    onClose={() => setShowSettingsModal(false)}
                    selectedShip={shipSettings}
                    selectedShipRole={shipSettings ? getShipConfig(shipSettings.id).shipRole : null}
                    selectedAlgorithm={
                        shipSettings
                            ? getShipConfig(shipSettings.id).selectedAlgorithm
                            : AutogearAlgorithm.Genetic
                    }
                    priorities={shipSettings ? getShipConfig(shipSettings.id).statPriorities : []}
                    ignoreEquipped={
                        shipSettings ? getShipConfig(shipSettings.id).ignoreEquipped : true
                    }
                    ignoreUnleveled={
                        shipSettings ? getShipConfig(shipSettings.id).ignoreUnleveled : true
                    }
                    showSecondaryRequirements={
                        shipSettings
                            ? getShipConfig(shipSettings.id).showSecondaryRequirements
                            : false
                    }
                    setPriorities={shipSettings ? getShipConfig(shipSettings.id).setPriorities : []}
                    statBonuses={shipSettings ? getShipConfig(shipSettings.id).statBonuses : []}
                    useUpgradedStats={
                        shipSettings ? getShipConfig(shipSettings.id).useUpgradedStats : false
                    }
                    tryToCompleteSets={
                        shipSettings ? getShipConfig(shipSettings.id).tryToCompleteSets : false
                    }
                    optimizeImplants={
                        shipSettings ? getShipConfig(shipSettings.id).optimizeImplants : false
                    }
                    onShipSelect={(ship) => {
                        if (selectedShips.length > 0) {
                            handleShipSelect(ship, 0);
                        }
                    }}
                    onRoleSelect={(role) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { shipRole: role });
                        }
                    }}
                    onAlgorithmSelect={(algorithm) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { selectedAlgorithm: algorithm });
                        }
                    }}
                    onAddPriority={(priority) => {
                        if (shipSettings) {
                            const config = getShipConfig(shipSettings.id);
                            updateShipConfig(shipSettings.id, {
                                statPriorities: [...config.statPriorities, priority],
                            });
                        }
                    }}
                    onRemovePriority={(index) => {
                        if (shipSettings) {
                            const config = getShipConfig(shipSettings.id);
                            updateShipConfig(shipSettings.id, {
                                statPriorities: config.statPriorities.filter((_, i) => i !== index),
                            });
                        }
                    }}
                    onFindOptimalGear={handleAutogear}
                    onIgnoreEquippedChange={(ignoreEquipped) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { ignoreEquipped });
                        }
                    }}
                    onIgnoreUnleveledChange={(ignoreUnleveled) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { ignoreUnleveled });
                        }
                    }}
                    onToggleSecondaryRequirements={(showSecondaryRequirements) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { showSecondaryRequirements });
                        }
                    }}
                    onAddSetPriority={(priority) => {
                        if (shipSettings) {
                            const config = getShipConfig(shipSettings.id);
                            updateShipConfig(shipSettings.id, {
                                setPriorities: [...config.setPriorities, priority],
                            });
                        }
                    }}
                    onRemoveSetPriority={(index) => {
                        if (shipSettings) {
                            const config = getShipConfig(shipSettings.id);
                            updateShipConfig(shipSettings.id, {
                                setPriorities: config.setPriorities.filter((_, i) => i !== index),
                            });
                        }
                    }}
                    onAddStatBonus={(bonus) => {
                        if (shipSettings) {
                            const config = getShipConfig(shipSettings.id);
                            updateShipConfig(shipSettings.id, {
                                statBonuses: [...config.statBonuses, bonus],
                            });
                        }
                    }}
                    onRemoveStatBonus={(index) => {
                        if (shipSettings) {
                            const config = getShipConfig(shipSettings.id);
                            updateShipConfig(shipSettings.id, {
                                statBonuses: config.statBonuses.filter((_, i) => i !== index),
                            });
                        }
                    }}
                    onUseUpgradedStatsChange={(useUpgradedStats) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { useUpgradedStats });
                        }
                    }}
                    onTryToCompleteSetsChange={(tryToCompleteSets) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { tryToCompleteSets });
                        }
                    }}
                    onOptimizeImplantsChange={(optimizeImplants) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, { optimizeImplants });
                        }
                    }}
                    onResetConfig={() => {
                        if (shipSettings) {
                            resetConfig(shipSettings.id);
                            updateShipConfig(shipSettings.id, {
                                shipRole: 'ATTACKER' as ShipTypeName,
                                statPriorities: [],
                                setPriorities: [],
                                statBonuses: [],
                                ignoreEquipped: true,
                                ignoreUnleveled: true,
                                useUpgradedStats: false,
                                tryToCompleteSets: false,
                                selectedAlgorithm: AutogearAlgorithm.Genetic,
                                showSecondaryRequirements: false,
                                optimizeImplants: false,
                            });
                            addNotification('success', 'Reset configuration to defaults');
                        }
                    }}
                />

                <ConfirmModal
                    isOpen={showConfirmModal}
                    onClose={() => setShowConfirmModal(false)}
                    onConfirm={() => {
                        if (currentEquippingShipId) {
                            applyGearSuggestionsForShip(currentEquippingShipId);
                        }
                    }}
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
