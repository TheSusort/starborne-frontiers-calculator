import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName } from '../../constants';
import { ShipDisplay } from './ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { Modal } from '../ui/layout/Modal';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { Button } from '../ui';
import { useNotification } from '../../hooks/useNotification';
import { ConfirmModal } from '../ui/layout/ConfirmModal';

interface Props {
    ship: Ship;
    allShips: Ship[];
    hoveredGear: GearPiece | null;
    availableGear: GearPiece[];
    getGearPiece: (id: string) => GearPiece | undefined;
    onHoverGear: (gear: GearPiece | null) => void;
    onEquipGear: (shipId: string, slot: GearSlotName, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlotName, showNotification?: boolean) => void;
    onEdit?: (ship: Ship) => void;
    onRemove?: (id: string) => void;
    onLockEquipment?: (ship: Ship) => Promise<void>;
    variant?: 'full' | 'compact' | 'extended';
}

export const ShipCard: React.FC<Props> = ({
    ship,
    allShips,
    hoveredGear,
    availableGear,
    getGearPiece,
    onEdit,
    onRemove,
    onLockEquipment,
    onEquipGear,
    onRemoveGear,
    onHoverGear,
    variant = 'full',
}) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingGear, setPendingGear] = useState<GearPiece | null>(null);
    const { addNotification } = useNotification();
    const gearLookup = useGearLookup(ship.equipment, getGearPiece);
    const activeSets = useGearSets(ship.equipment, gearLookup);

    const handleUnequipAll = () => {
        Object.entries(GEAR_SLOTS).forEach(([key]) => {
            onRemoveGear(ship.id, key as GearSlotName, false);
        });
        addNotification('success', `Unequipped all gear on ${ship.name}`);
    };

    const handleEquipAttempt = (gear: GearPiece) => {
        // First check if the gear is on a locked ship
        const lockedShip = allShips.find(
            (s) =>
                s.equipmentLocked &&
                s.id !== ship.id &&
                Object.values(s.equipment).includes(gear.id)
        );

        if (lockedShip) {
            addNotification(
                'error',
                `This gear is locked to ${lockedShip.name}. Please unlock the ship's equipment first.`
            );
            return;
        }

        // Then proceed with normal equip logic
        if (gear.shipId && gear.shipId !== ship.id) {
            setPendingGear(gear);
            setShowConfirmModal(true);
        } else if (selectedSlot) {
            onEquipGear(ship.id, selectedSlot, gear.id);
            setSelectedSlot(null);
            addNotification('success', `Equipped ${gear.slot} on ${ship.name}`);
        }
    };

    const handleConfirmEquip = () => {
        if (pendingGear && selectedSlot) {
            onEquipGear(ship.id, selectedSlot, pendingGear.id);
            setSelectedSlot(null);
            addNotification('success', `Equipped ${pendingGear.slot} on ${ship.name}`);
            setPendingGear(null);
        }
    };

    return (
        <>
            <ShipDisplay
                ship={ship}
                onEdit={onEdit}
                onRemove={onRemove}
                onLockEquipment={onLockEquipment}
                variant={variant}
            >
                <div className="p-4 bg-dark">
                    <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                        {Object.entries(GEAR_SLOTS).map(([key, _]) => (
                            <GearSlot
                                key={key}
                                slotKey={key as GearSlotName}
                                gear={gearLookup[ship.equipment[key as GearSlotName] || '']}
                                hoveredGear={hoveredGear}
                                onSelect={setSelectedSlot}
                                onRemove={(slot) => onRemoveGear(ship.id, slot)}
                                onHover={onHoverGear}
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
                        {Object.values(ship.equipment) && (
                            <Button
                                aria-label="Unequip all gear"
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
                title={`Select ${selectedSlot} for ${ship.name}`}
            >
                <GearInventory
                    inventory={availableGear.filter(
                        (gear) => selectedSlot && gear.slot === selectedSlot
                    )}
                    mode="select"
                    onEquip={handleEquipAttempt}
                    onRemove={() => {}}
                    onEdit={() => {}}
                />
            </Modal>

            <ConfirmModal
                isOpen={showConfirmModal}
                onClose={() => {
                    setShowConfirmModal(false);
                    setPendingGear(null);
                }}
                onConfirm={handleConfirmEquip}
                title="Move Gear"
                message={`This ${pendingGear?.slot} is currently equipped on ${allShips.find((s) => s.id === pendingGear?.shipId)?.name || 'another ship'}. Would you like to move it to ${ship.name} instead?`}
                confirmLabel="Move"
                cancelLabel="Cancel"
            />
        </>
    );
};
