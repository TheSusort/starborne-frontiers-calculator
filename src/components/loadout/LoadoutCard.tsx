import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName, RARITIES } from '../../constants';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { Modal, Button, CloseIcon } from '../ui';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';

interface LoadoutCardProps {
    name?: string; // Optional for team loadouts
    ship: Ship;
    equipment: Record<GearSlotName, string>;
    availableGear: GearPiece[];
    getGearPiece: (id: string) => GearPiece | undefined;
    onEquip?: () => void; // Optional for team loadouts
    onUpdate: (equipment: Record<GearSlotName, string>) => void;
    onDelete?: () => void; // Optional for team loadouts
    showControls?: boolean; // Whether to show equip/delete buttons
}

export const LoadoutCard: React.FC<LoadoutCardProps> = ({
    name,
    ship,
    equipment,
    availableGear,
    getGearPiece,
    onEquip,
    onUpdate,
    onDelete,
    showControls = true,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const gearLookup = useGearLookup(equipment, getGearPiece);
    const activeSets = useGearSets(equipment, gearLookup);

    const handleEquipGear = (slot: GearSlotName, gearId: string) => {
        const newEquipment = {
            ...equipment,
            [slot]: gearId,
        };
        onUpdate(newEquipment);
    };

    return (
        <>
            {(name || showControls) && (
                <div className="flex justify-between items-center mb-4">
                    <div>
                        {name && (
                            <h3 className="text-lg font-medium text-gray-200">{name}</h3>
                        )}
                    </div>
                    {showControls && (
                        <div className="flex gap-2">
                            {onEquip && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={onEquip}
                                >
                                    Equip to Ship
                                </Button>
                            )}
                            {onDelete && (
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={onDelete}
                                >
                                    <CloseIcon />
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            <ShipDisplay ship={ship} variant="compact">
                <div className={`p-4 mt-3 -mx-3 bg-dark border-t ${RARITIES[ship.rarity || 'common'].borderColor}`}>
                    <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                        {Object.entries(GEAR_SLOTS).map(([key, slot]) => (
                            <GearSlot
                                key={key}
                                slotKey={key as GearSlotName}
                                slotData={slot}
                                gear={gearLookup[equipment[key as GearSlotName] || '']}
                                hoveredGear={hoveredGear}
                                onSelect={setSelectedSlot}
                                onHover={setHoveredGear}
                            />
                        ))}
                    </div>

                    {activeSets && activeSets.length > 0 && (
                        <div className="flex items-center gap-2 pt-3">
                            <span className="text-xs text-gray-400">Sets:</span>
                            {activeSets.map((setName, index) => (
                                <img
                                    key={`${setName}-${index}`}
                                    src={GEAR_SETS[setName].iconUrl}
                                    alt={setName}
                                    className="w-5"
                                />
                            ))}
                        </div>
                    )}
                </div>
            </ShipDisplay>

            <Modal
                isOpen={selectedSlot !== null}
                onClose={() => setSelectedSlot(null)}
                title={`Select ${selectedSlot} for ${ship.name} loadout`}
            >
                <GearInventory
                    inventory={availableGear.filter(gear =>
                        selectedSlot && gear.slot === selectedSlot
                    )}
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
        </>
    );
};