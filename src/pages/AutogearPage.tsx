import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { useInventory } from '../hooks/useInventory';
import { Button } from '../components/ui';
import { Modal } from '../components/layout/Modal';
import { ShipDisplay } from '../components/ship/ShipDisplay';
import { StatPriorityForm } from '../components/stats/StatPriorityForm';
import { GearSuggestion, StatPriority } from '../types/autogear';
import { GearSlot } from '../components/gear/GearSlot';
import { GEAR_SLOTS, GearSlotName, GEAR_SLOT_ORDER } from '../constants';
import { GearPiece } from '../types/gear';
import { StatName } from '../types/stats';
import { calculateTotalStats } from '../utils/statsCalculator';
import { PageLayout } from '../components/layout/PageLayout';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { AutogearAlgorithm, AUTOGEAR_STRATEGIES } from '../utils/autogear/AutogearStrategy';
import { getAutogearStrategy } from '../utils/autogear/getStrategy';

export const AutogearPage: React.FC = () => {
    const { ships, getShipById, updateShip } = useShips();
    const { getGearPiece, inventory } = useInventory();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const [priorities, setPriorities] = useState<StatPriority[]>([]);
    const [suggestions, setSuggestions] = useState<GearSuggestion[]>([]);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [selectedAlgorithm, setSelectedAlgorithm] = useState<AutogearAlgorithm>(AutogearAlgorithm.BeamSearch);

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

    return (
        <PageLayout
            title="Autogear"
            description="Find the best gear for your ship."
        >

            {currentStats && suggestedStats && suggestions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-200">
                    <div className="bg-dark p-4 rounded space-y-2">
                        <h3 className="text-lg font-semibold">Current Stats</h3>
                        {Object.entries(currentStats).map(([statName, value]) => (
                            <div key={statName} className="flex justify-between items-center">
                                <span className="text-gray-300">{statName}</span>
                                <span className="text-gray-300">{Math.round(value)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="bg-dark p-4 rounded space-y-2">
                        <h3 className="text-lg font-semibold">Stats with Suggested Gear</h3>
                        {Object.entries(suggestedStats).map(([statName, value]) => {
                            const currentValue = currentStats[statName as StatName] || 0;
                            const difference = value - currentValue;
                            return (
                                <div key={statName} className="flex justify-between items-center">
                                    <span className="text-gray-300">{statName}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-300">{Math.round(value)}</span>
                                        {difference !== 0 && (
                                            <span className={difference > 0 ? "text-green-500" : "text-red-500"}>
                                                ({difference > 0 ? '+' : ''}{Math.round(difference)})
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                    <h3 className="text-xl font-bold text-gray-200">Settings</h3>
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

                    <StatPriorityForm
                        onAdd={handleAddPriority}
                        existingPriorities={priorities}
                    />

                    {priorities.length > 0 && (
                        <div className="bg-dark p-4 rounded space-y-2">
                            <h3 className="text-lg font-semibold text-gray-200">Priority List</h3>
                            {priorities.map((priority, index) => (
                                <div key={index} className="flex justify-between items-center">
                                    <span className="text-gray-300">
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
        </PageLayout>
    );
};