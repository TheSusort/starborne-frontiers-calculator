import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName } from '../../constants';
import { ShipDisplay } from './ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { Modal } from '../layout/Modal';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { Button } from '../ui/Button';

interface Props {
    ship: Ship;
    hoveredGear: GearPiece | null;
    availableGear: GearPiece[];
    getGearPiece: (id: string) => GearPiece | undefined;
    onEdit: (ship: Ship) => void;
    onRemove: (id: string) => void;
    onEquipGear: (shipId: string, slot: GearSlotName, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlotName) => void;
    onHoverGear: (gear: GearPiece | null) => void;
}

export const ShipCard: React.FC<Props> = ({
    ship,
    hoveredGear,
    availableGear,
    getGearPiece,
    onEdit,
    onRemove,
    onEquipGear,
    onRemoveGear,
    onHoverGear,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const gearLookup = useGearLookup(ship.equipment, getGearPiece);
    const activeSets = useGearSets(ship.equipment, gearLookup);

    const handleUnequipAll = () => {
        Object.entries(GEAR_SLOTS).forEach(([key]) => {
            onRemoveGear(ship.id, key as GearSlotName);
        });
    };

    return (
        <div>
            <ShipDisplay ship={ship} onEdit={onEdit} onRemove={onRemove} variant='extended'>
                <div className="p-4 bg-dark">
                    <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                        {Object.entries(GEAR_SLOTS).map(([key, slot]) => (
                            <GearSlot
                                key={key}
                                slotKey={key as GearSlotName}
                                slotData={slot}
                                gear={gearLookup[ship.equipment[key as GearSlotName] || '']}
                                hoveredGear={hoveredGear}
                                onSelect={setSelectedSlot}
                                onRemove={(slot) => onRemoveGear(ship.id, slot)}
                                onHover={onHoverGear}
                            />
                        ))}
                    </div>

                    <div className="flex items-center gap-2 pt-3">
                        <span className="text-xs text-gray-400">Gear Sets:</span>
                        {activeSets.map((setName, index) => (
                            <img
                                key={`${setName}-${index}`}
                                src={GEAR_SETS[setName].iconUrl}
                                alt={setName}
                                className="w-5"
                            />
                        ))}

                        <Button
                            className='ml-auto'
                            variant="secondary"
                            onClick={handleUnequipAll}
                        >
                            Unequip All
                        </Button>
                    </div>
                </div>
            </ShipDisplay>

            <Modal
                isOpen={selectedSlot !== null}
                onClose={() => setSelectedSlot(null)}
                title={`Select ${selectedSlot} for ${ship.name}`}
            >
                <GearInventory
                    inventory={availableGear.filter(gear => selectedSlot && gear.slot === selectedSlot)}
                    mode="select"
                    onEquip={(gear) => {
                        if (selectedSlot) {
                            onEquipGear(ship.id, selectedSlot, gear.id);
                            setSelectedSlot(null);
                        }
                    }}
                    onRemove={() => { }}
                    onEdit={() => { }}
                />
            </Modal>
        </div>
    );
};