import React, { useState } from 'react';
import { Loadout } from '../../types/loadout';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName, RARITIES } from '../../constants';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { Modal, Button } from '../ui';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { useShips } from '../../hooks/useShips';

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
    const { handleEquipGear } = useShips();

    const handleEquipGearLoadout = (slot: GearSlotName, gearId: string) => {
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
        for (const [slot, gearId] of Object.entries(loadout.equipment)) {
            handleEquipGear(ship.id, slot as GearSlotName, gearId);
        }
    };

    return (
        <div className="bg-dark">
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
                <div className={`p-4 mt-3 -mx-3 bg-dark border-t ${RARITIES[ship.rarity || 'common'].borderColor}`}>
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
                        {activeSets && (
                            <>
                                <span className="text-xs text-gray-400">Gear Sets:</span>
                                {activeSets.map((setName, index) => (
                                    <img
                                        key={`${setName}-${index}`}
                                        src={GEAR_SETS[setName].iconUrl}
                                        alt={setName}
                                        className="w-5"
                                    />
                                ))}
                            </>
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
                            handleEquipGearLoadout(selectedSlot, gear.id);
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