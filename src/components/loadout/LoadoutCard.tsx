import React, { useState } from 'react';
import { Loadout } from '../../types/loadout';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SLOTS, GearSlotName } from '../../constants';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { Modal } from '../layout/Modal';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { Button } from '../ui/Button';

interface LoadoutCardProps {
    loadout: Loadout;
    ship: Ship;
    availableGear: GearPiece[];
    getGearPiece: (id: string) => GearPiece | undefined;
    onUpdate: (id: string, equipment: Record<GearSlotName, string>) => void;
    onDelete: (id: string) => void;
}

export const LoadoutCard: React.FC<LoadoutCardProps> = ({
    loadout,
    ship,
    availableGear,
    getGearPiece,
    onUpdate,
    onDelete,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const gearLookup = useGearLookup(loadout.equipment, getGearPiece);
    const activeSets = useGearSets(loadout.equipment, gearLookup);

    const handleEquipGear = (slot: GearSlotName, gearId: string) => {
        const newEquipment = {
            ...loadout.equipment,
            [slot]: gearId,
        };
        onUpdate(loadout.id, newEquipment);
    };

    const handleRemoveGear = (slot: GearSlotName) => {
        const newEquipment = { ...loadout.equipment };
        delete newEquipment[slot];
        onUpdate(loadout.id, newEquipment);
    };

    const handleEquipLoadout = () => {
        // TODO: Implement equipping loadout to ship
        console.log('Equip loadout to ship:', loadout.equipment);
    };

    const handleUnequipAll = () => {
        onUpdate(loadout.id, {});
    };

    return (
        <div className="bg-dark rounded-lg overflow-hidden">
            <div className="p-4 bg-dark-lighter">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium text-gray-200">{loadout.name}</h3>
                    <div className="flex gap-2">
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleEquipLoadout}
                        >
                            Equip to Ship
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={() => onDelete(loadout.id)}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </div>

            <ShipDisplay ship={ship} variant="compact">
                <div className="p-4 bg-dark">
                    <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                        {Object.entries(GEAR_SLOTS).map(([key, slot]) => (
                            <GearSlot
                                key={key}
                                slotKey={key as GearSlotName}
                                slotData={slot}
                                gear={gearLookup[loadout.equipment[key as GearSlotName] || '']}
                                hoveredGear={hoveredGear}
                                onSelect={setSelectedSlot}
                                onRemove={handleRemoveGear}
                                onHover={setHoveredGear}
                            />
                        ))}
                    </div>

                    <div className="flex items-center gap-2 pt-3">
                        {activeSets && activeSets.length > 0 && (
                            <>
                                <span className="text-xs text-gray-400">Active Sets:</span>
                                {activeSets.map((setName) => (
                                    <span
                                        key={setName}
                                        className="text-xs text-gray-200"
                                    >
                                        {setName}
                                    </span>
                                ))}
                            </>
                        )}
                        {Object.keys(loadout.equipment).length > 0 && (
                            <Button
                                className="ml-auto"
                                variant="secondary"
                                size="xs"
                                onClick={handleUnequipAll}
                            >
                                Unequip All
                            </Button>
                        )}
                    </div>
                </div>
            </ShipDisplay>

            <Modal
                isOpen={selectedSlot !== null}
                onClose={() => setSelectedSlot(null)}
                title={`Select ${selectedSlot} for ${loadout.name}`}
            >
                <GearInventory
                    inventory={availableGear.filter(gear => selectedSlot && gear.slot === selectedSlot)}
                    mode="select"
                    onEquip={(gear) => {
                        if (selectedSlot) {
                            handleEquipGear(selectedSlot, gear.id);
                            setSelectedSlot(null);
                        }
                    }}
                    onRemove={() => {}}
                    onEdit={() => {}}
                />
            </Modal>
        </div>
    );
}; 