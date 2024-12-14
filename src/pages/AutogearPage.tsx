import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { useInventory } from '../hooks/useInventory';
import { Button } from '../components/ui';
import { StatPriorityForm } from '../components/stats/StatPriorityForm';
import { GearSuggestion, StatPriority } from '../types/autogear';
import { GearSlot } from '../components/gear/GearSlot';
import { GEAR_SLOTS, GearSlotName, GEAR_SLOT_ORDER } from '../constants';
import { GearPiece } from '../types/gear';
import { calculateTotalStats } from '../utils/statsCalculator';
import { PageLayout } from '../components/layout/PageLayout';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { AutogearAlgorithm, AUTOGEAR_STRATEGIES } from '../utils/autogear/AutogearStrategy';
import { getAutogearStrategy } from '../utils/autogear/getStrategy';
import { runDamageSimulation, SimulationSummary } from '../utils/simulationCalculator';
import { StatList } from '../components/stats/StatList';
import { ShipSelector } from '../components/ship/ShipSelector';

export const AutogearPage: React.FC = () => {
    const { getShipById, updateShip } = useShips();
    const { getGearPiece, inventory } = useInventory();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [priorities, setPriorities] = useState<StatPriority[]>([]);
    const [suggestions, setSuggestions] = useState<GearSuggestion[]>([]);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [selectedAlgorithm, setSelectedAlgorithm] = useState<AutogearAlgorithm>(AutogearAlgorithm.BeamSearch);
    const [currentSimulation, setCurrentSimulation] = useState<SimulationSummary | null>(null);
    const [suggestedSimulation, setSuggestedSimulation] = useState<SimulationSummary | null>(null);

    const selectedShip = getShipById(selectedShipId);

    const handleAddPriority = (priority: StatPriority) => {
        setPriorities([...priorities, priority]);
    };

    const handleRemovePriority = (index: number) => {
        setPriorities(priorities.filter((_, i) => i !== index));
    };

    const handleAutogear = () => {
        if (!selectedShip) return;

        const strategy = getAutogearStrategy(selectedAlgorithm);
        const suggestions = strategy.findOptimalGear(
            selectedShip,
            priorities,
            inventory,
            getGearPiece,
            getEngineeringStatsForShipType
        );

        setSuggestions(suggestions);

        // Run simulations for both current and suggested gear
        const currentStats = getCurrentStats();
        const suggestedStats = getSuggestedStats();

        if (currentStats && suggestedStats) {
            setCurrentSimulation(runDamageSimulation(currentStats));
            setSuggestedSimulation(runDamageSimulation(suggestedStats));
        }
    };

    const handleEquipSuggestions = () => {
        if (!selectedShip) return;

        const updatedEquipment = { ...selectedShip.equipment };
        suggestions.forEach(suggestion => {
            updatedEquipment[suggestion.slotName as GearSlotName] = suggestion.gearId;
        });

        updateShip({
            ...selectedShip,
            equipment: updatedEquipment
        });

        // Clear suggestions after equipping
        setSuggestions([]);
    };

    const getSuggestionForSlot = (slotName: GearSlotName) => {
        return suggestions.find(s => s.slotName === slotName);
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

    const getSuggestedStats = () => {
        if (!selectedShip) return null;

        // Create equipment object with suggested gear
        const suggestedEquipment = { ...selectedShip.equipment };
        suggestions.forEach(suggestion => {
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

    const currentStats = getCurrentStats();
    const suggestedStats = getSuggestedStats();

    const renderSimulationResults = () => {
        if (!currentSimulation || !suggestedSimulation) return null;

        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-gray-200">
                <div className="bg-dark p-4 rounded space-y-2">
                    <h3 className="text-lg font-semibold">Current Gear Simulation</h3>
                    <div className="flex flex-col gap-2">
                        <div>
                            <span className="text-gray-400">Average Damage:</span>
                            <span className="ml-2">{currentSimulation.averageDamage}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Highest Hit:</span>
                            <span className="ml-2">{currentSimulation.highestHit}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Lowest Hit:</span>
                            <span className="ml-2">{currentSimulation.lowestHit}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-dark p-4 rounded space-y-2">
                    <h3 className="text-lg font-semibold">Suggested Gear Simulation</h3>
                    <div className="flex flex-col gap-2">
                        <div>
                            <span className="text-gray-400">Average Damage:</span>
                            <span className="ml-2">
                                {suggestedSimulation.averageDamage}
                                <span className={`ml-2 ${suggestedSimulation.averageDamage > currentSimulation.averageDamage ? 'text-green-500' : 'text-red-500'}`}>
                                    ({((suggestedSimulation.averageDamage - currentSimulation.averageDamage) / currentSimulation.averageDamage * 100).toFixed(1)}%)
                                </span>
                            </span>
                        </div>
                        <div>
                            <span className="text-gray-400">Highest Hit:</span>
                            <span className="ml-2">{suggestedSimulation.highestHit}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Lowest Hit:</span>
                            <span className="ml-2">{suggestedSimulation.lowestHit}</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <PageLayout
            title="Autogear"
            description="Find the best gear for your ship."
        >

            {currentStats && suggestedStats && suggestions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-200">
                    <StatList
                        stats={currentStats}
                        title="Current Stats"
                        className="p-4"
                    />
                    <StatList
                        stats={suggestedStats}
                        comparisonStats={currentStats}
                        title="Stats with Suggested Gear"
                        className="p-4"
                    />
                </div>
            )}

            {currentStats && suggestedStats && suggestions.length > 0 && renderSimulationResults()}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                    <h3 className="text-xl font-bold text-gray-200">Settings</h3>
                    <ShipSelector
                        onSelect={(ship) => setSelectedShipId(ship.id)}
                        selected={selectedShip || null}
                    />

                    <StatPriorityForm
                        onAdd={handleAddPriority}
                        existingPriorities={priorities}
                    />

                    {priorities.length > 0 && (
                        <div className="bg-dark p-4 rounded space-y-2 text-gray-200">
                            <h3 className="text-lg font-semibold">Priority List</h3>
                            {priorities.map((priority, index) => (
                                <div key={index} className="flex justify-between items-center">
                                    <span>{index + 1}</span>
                                    <span>
                                        {priority.stat}
                                        {priority.maxLimit ? ` (Max: ${priority.maxLimit})` : ''}
                                    </span>
                                    <Button
                                        variant="danger"
                                        onClick={() => handleRemovePriority(index)}
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-2 p-4 bg-dark">
                        <span className="text-gray-300 text-sm">Algorithm</span>
                        <select
                            className="w-full p-2 bg-dark border border-gray-700 rounded text-gray-200"
                            value={selectedAlgorithm}
                            onChange={(e) => setSelectedAlgorithm(e.target.value as AutogearAlgorithm)}
                    >
                        {Object.entries(AUTOGEAR_STRATEGIES).map(([key, { name, description }]) => (
                            <option key={key} value={key}>
                                {name}
                            </option>
                            ))}
                        </select>
                        <p className="text-sm text-gray-400">
                            {AUTOGEAR_STRATEGIES[selectedAlgorithm].description}
                        </p>
                    </div>

                    <Button
                        variant="primary"
                        onClick={handleAutogear}
                        disabled={!selectedShipId || priorities.length === 0}
                        fullWidth
                    >
                        Find Optimal Gear
                    </Button>
                </div>

                {suggestions.length > 0 && (
                    <div className="bg-dark-lighter p-4 pt-0 rounded">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-semibold text-gray-200">Suggested Gear</h3>
                        </div>
                        <div className="grid grid-cols-3 gap-2 bg-dark p-4">
                            {GEAR_SLOT_ORDER.map((slotName) => {
                                const suggestion = getSuggestionForSlot(slotName);
                                return (
                                    <div key={slotName} className="flex items-center justify-center">
                                        <GearSlot
                                            slotKey={slotName}
                                            slotData={GEAR_SLOTS[slotName]}
                                            gear={suggestion ? getGearPiece(suggestion.gearId) : undefined}
                                            hoveredGear={hoveredGear}
                                            onHover={setHoveredGear}
                                        />
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex justify-end pt-4">
                            <Button
                                variant="primary"
                                onClick={handleEquipSuggestions}
                            >
                                Equip All Suggestions
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </PageLayout>
    );
};