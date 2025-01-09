import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName, RARITIES } from '../../constants';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { Modal, Button, CloseIcon, CheckIcon } from '../ui';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { useShips } from '../../hooks/useShips';
import { useInventory } from '../../hooks/useInventory';
import { useNotification } from '../../hooks/useNotification';

interface LoadoutCardProps {
    name?: string;
    ship: Ship;
    equipment: Record<GearSlotName, string>;
    availableGear: GearPiece[];
    getGearPiece: (id: string) => GearPiece | undefined;
    onEquip?: () => void;
    onUpdate: (equipment: Record<GearSlotName, string>) => void;
    onDelete?: () => void;
    showControls?: boolean;
}

export const LoadoutCard: React.FC<LoadoutCardProps> = ({
    name,
    ship,
    equipment,
    availableGear,
    getGearPiece,
    onEquip,
    onDelete,
    showControls = true,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const gearLookup = useGearLookup(equipment, getGearPiece);
    const activeSets = useGearSets(equipment, gearLookup);
    const { handleEquipGear } = useShips();
    const { saveInventory } = useInventory();
    const { addNotification } = useNotification();

    const handleEquipLoadout = () => {
        if (!onEquip) return;

        const inventoryUpdates = new Map<string, string>();
        const processedGear = new Set<string>();

        Object.entries(equipment).forEach(([slot, gearId]) => {
            if (processedGear.has(gearId)) {
                addNotification('warning', `Skipped duplicate gear assignment for ${slot}`);
                return;
            }

            const gear = getGearPiece(gearId);
            if (!gear) {
                addNotification('error', `Gear piece ${gearId} not found in inventory`);
                return;
            }

            if (gear.shipId && gear.shipId !== ship.id) {
                const previousShip = gear.shipId;
                addNotification('info', `Unequipped ${slot} from ship ${previousShip}`);
            }

            inventoryUpdates.set(gearId, ship.id);
            processedGear.add(gearId);

            handleEquipGear(ship.id, slot as GearSlotName, gearId);
        });

        // Update inventory
        const newInventory = availableGear.map((gear) => {
            const newShipId = inventoryUpdates.get(gear.id);
            if (newShipId !== undefined) {
                return { ...gear, shipId: newShipId };
            }
            return gear;
        });

        saveInventory(newInventory);
        addNotification('success', 'Loadout equipped successfully');
        onEquip();
    };

    return (
        <>
            {name && (
                <div className="flex justify-between items-center mb-4">
                    <div>{name && <h3 className="text-lg font-medium ">{name}</h3>}</div>
                </div>
            )}

            <ShipDisplay ship={ship} variant="compact">
                {showControls && (
                    <div className="flex gap-2 -mt-10">
                        {onEquip && (
                            <Button
                                aria-label="Equip loadout"
                                variant="primary"
                                className="ms-auto"
                                size="sm"
                                onClick={handleEquipLoadout}
                            >
                                <CheckIcon />
                            </Button>
                        )}
                        {onDelete && (
                            <Button
                                aria-label="Delete loadout"
                                variant="danger"
                                size="sm"
                                onClick={onDelete}
                            >
                                <CloseIcon />
                            </Button>
                        )}
                    </div>
                )}
                <div
                    className={`p-4 mt-3 -mx-3 bg-dark border-t ${RARITIES[ship.rarity || 'common'].borderColor}`}
                >
                    <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                        {Object.entries(GEAR_SLOTS).map(([key, _]) => (
                            <GearSlot
                                key={key}
                                slotKey={key as GearSlotName}
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
                    inventory={availableGear.filter(
                        (gear) => selectedSlot && gear.slot === selectedSlot
                    )}
                    mode="select"
                    onEquip={() => {
                        if (selectedSlot) {
                            handleEquipLoadout();
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
