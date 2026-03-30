import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName, RARITIES } from '../../constants';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { GearPieceDisplay } from '../gear/GearPieceDisplay';
import { Modal, Button, CloseIcon, CheckIcon, EditIcon } from '../ui';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { useShips } from '../../contexts/ShipsContext';
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
    onEdit?: () => void;
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
    onEdit,
    showControls = true,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [expanded, setExpanded] = useState(false);
    const gearLookup = useGearLookup(equipment, getGearPiece);
    const activeSets = useGearSets(equipment, gearLookup);
    const { equipGear } = useShips();
    const { addNotification } = useNotification();

    const handleEquipLoadout = () => {
        if (!onEquip) return;

        Object.entries(equipment).forEach(([slot, gearId]) => {
            const gear = getGearPiece(gearId);
            if (!gear) {
                addNotification('error', `Gear piece ${gearId} not found in inventory`);
                return;
            }

            if (gear.shipId && gear.shipId !== ship.id) {
                const previousShip = gear.shipId;
                addNotification('info', `Unequipped ${slot} from ship ${previousShip}`);
            }

            void equipGear(ship.id, slot, gearId);
        });

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

            <ShipDisplay ship={ship} variant="compact" contentClassName="flex-col grow-0">
                {showControls && (
                    <div className="flex gap-2 -mt-10">
                        {onEdit && (
                            <Button
                                aria-label="Edit loadout"
                                title="Edit loadout"
                                variant="secondary"
                                className="ms-auto"
                                size="sm"
                                onClick={onEdit}
                            >
                                <EditIcon />
                            </Button>
                        )}
                        {onEquip && (
                            <Button
                                aria-label="Equip loadout"
                                title="Equip loadout"
                                variant="secondary"
                                className={!onEdit ? 'ms-auto' : ''}
                                size="sm"
                                onClick={handleEquipLoadout}
                            >
                                <CheckIcon />
                            </Button>
                        )}
                        {onDelete && (
                            <Button
                                aria-label="Delete loadout"
                                title="Delete loadout"
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
                                slotKey={key}
                                gear={gearLookup[equipment[key] || '']}
                                hoveredGear={hoveredGear}
                                onSelect={setSelectedSlot}
                                onHover={setHoveredGear}
                            />
                        ))}
                    </div>

                    <div className="flex items-center gap-2 pt-3">
                        {activeSets && activeSets.length > 0 && (
                            <>
                                <span className="text-xs text-theme-text-secondary">Sets:</span>
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
                        <Button
                            aria-label="Expand gear view"
                            className="ml-auto"
                            variant="secondary"
                            size="xs"
                            onClick={() => setExpanded(true)}
                        >
                            Expand
                        </Button>
                    </div>
                </div>
            </ShipDisplay>

            <Modal
                isOpen={expanded}
                onClose={() => setExpanded(false)}
                title={`${name || ship.name} Loadout`}
            >
                <ShipDisplay ship={ship} variant="compact" contentClassName="flex-col">
                    {showControls && (
                        <div className="flex gap-2 -mt-10">
                            {onEdit && (
                                <Button
                                    aria-label="Edit loadout"
                                    title="Edit loadout"
                                    variant="secondary"
                                    className="ms-auto"
                                    size="sm"
                                    onClick={() => {
                                        setExpanded(false);
                                        onEdit();
                                    }}
                                >
                                    <EditIcon />
                                </Button>
                            )}
                            {onEquip && (
                                <Button
                                    aria-label="Equip loadout"
                                    title="Equip loadout"
                                    variant="secondary"
                                    className={!onEdit ? 'ms-auto' : ''}
                                    size="sm"
                                    onClick={handleEquipLoadout}
                                >
                                    <CheckIcon />
                                </Button>
                            )}
                            {onDelete && (
                                <Button
                                    aria-label="Delete loadout"
                                    title="Delete loadout"
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
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {Object.entries(GEAR_SLOTS).map(([key, _]) => {
                                const gear = gearLookup[equipment[key] || ''];
                                if (!gear) return null;
                                return (
                                    <div key={key} className="flex justify-center">
                                        <GearPieceDisplay gear={gear} mode="compact" small />
                                    </div>
                                );
                            })}
                        </div>

                        {activeSets && activeSets.length > 0 && (
                            <div className="flex items-center gap-2 pt-3">
                                <span className="text-xs text-theme-text-secondary">Sets:</span>
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
            </Modal>

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
