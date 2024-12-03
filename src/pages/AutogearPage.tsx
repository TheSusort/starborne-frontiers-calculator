import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { useInventory } from '../hooks/useInventory';
import { Button } from '../components/ui';
import { Modal } from '../components/Modal';
import { ShipDisplay } from '../components/ShipDisplay';
import { StatPriorityForm } from '../components/StatPriorityForm';
import { GearSuggestion, StatPriority } from '../types/autogear';
import { findOptimalGear } from '../utils/autogearCalculator';
import { GearPieceDisplay } from '../components/GearPieceDisplay';
import { GearSlotName } from '../constants';

export const AutogearPage: React.FC = () => {
    const { ships, getShipById, updateShip } = useShips();
    const { getGearPiece, inventory } = useInventory();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const [priorities, setPriorities] = useState<StatPriority[]>([]);
    const [suggestions, setSuggestions] = useState<GearSuggestion[]>([]);

    const selectedShip = getShipById(selectedShipId);

    const handleAddPriority = (priority: StatPriority) => {
        setPriorities([...priorities, priority]);
    };

    const handleRemovePriority = (index: number) => {
        setPriorities(priorities.filter((_, i) => i !== index));
    };

    const handleAutogear = () => {
        if (!selectedShip) return;

        const suggestions = findOptimalGear(
            selectedShip,
            priorities,
            inventory,
            getGearPiece
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

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-white">Autogear</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                    <Button
                        variant="secondary"
                        onClick={() => setIsShipModalOpen(true)}
                        fullWidth
                    >
                        {selectedShip ? (
                            <ShipDisplay ship={selectedShip} />
                        ) : (
                            'Select a Ship'
                        )}
                    </Button>

                    <StatPriorityForm
                        onAdd={handleAddPriority}
                        existingPriorities={priorities}
                    />

                    {priorities.length > 0 && (
                        <div className="bg-dark-lighter p-4 rounded space-y-2">
                            <h3 className="text-lg font-semibold text-white">Priority List</h3>
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
                    <div className="bg-dark-lighter p-4 rounded">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-white">Suggested Gear</h3>
                            <Button
                                variant="primary"
                                onClick={handleEquipSuggestions}
                            >
                                Equip All Suggestions
                            </Button>
                        </div>
                        <div className="space-y-2">
                            {suggestions.map((suggestion, index) => (
                                <div key={index} className="flex justify-between items-center">
                                    <span className="text-gray-300">{suggestion.slotName}</span>
                                    {getGearPiece(suggestion.gearId) && (
                                        <GearPieceDisplay gear={getGearPiece(suggestion.gearId)!} />
                                    )}
                                </div>
                            ))}
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
        </div>
    );
};