import React, { useState, useRef } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import {
    GEAR_SETS,
    GEAR_SLOTS,
    GearSlotName,
    IMPLANT_SLOTS,
    ImplantSlotName,
} from '../../constants';
import { ShipDisplay } from './ShipDisplay';
import { ShipDisplayImage } from './ShipDisplayImage';
import { GearSlot } from '../gear/GearSlot';
import { GearPieceDisplay } from '../gear/GearPieceDisplay';
import { Modal } from '../ui/layout/Modal';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { Button, Tooltip } from '../ui';
import { useNotification } from '../../hooks/useNotification';
import { ConfirmModal } from '../ui/layout/ConfirmModal';
import { StatDisplay } from '../stats/StatDisplay';

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
    onUnequipAll: (shipId: string) => void;
    onEquipImplant?: (shipId: string, slot: ImplantSlotName, gearId: string) => void;
    onRemoveImplant?: (shipId: string, slot: ImplantSlotName) => void;
    variant?: 'full' | 'compact' | 'extended';
    viewMode?: 'list' | 'image';
    onAddToComparison?: (shipId: string) => void;
    isInComparison?: boolean;
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
    onUnequipAll,
    onEquipImplant,
    onRemoveImplant,
    variant = 'full',
    viewMode = 'list',
    onAddToComparison,
    isInComparison,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<(GearSlotName | ImplantSlotName) | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingGear, setPendingGear] = useState<GearPiece | null>(null);
    const [expanded, setExpanded] = useState(false);
    const { addNotification } = useNotification();
    const gearLookup = useGearLookup(ship.equipment, getGearPiece);
    const activeSets = useGearSets(ship.equipment, gearLookup);
    const [showGearSets, setShowGearSets] = useState(false);
    const gearSetsTooltipRef = useRef<HTMLDivElement>(null);
    const handleUnequipAll = () => {
        onUnequipAll(ship.id);
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
            // Check if this is an implant slot
            if (selectedSlot.startsWith('implant_')) {
                if (onEquipImplant) {
                    onEquipImplant(ship.id, selectedSlot as ImplantSlotName, gear.id);
                    setSelectedSlot(null);
                    addNotification(
                        'success',
                        `Equipped ${IMPLANT_SLOTS[selectedSlot].label} on ${ship.name}`
                    );
                }
            } else {
                onEquipGear(ship.id, selectedSlot as GearSlotName, gear.id);
                setSelectedSlot(null);
                addNotification('success', `Equipped ${gear.slot} on ${ship.name}`);
            }
        }
    };

    const handleConfirmEquip = () => {
        if (pendingGear && selectedSlot) {
            // Check if this is an implant slot
            if (selectedSlot.startsWith('implant_')) {
                if (onEquipImplant) {
                    onEquipImplant(ship.id, selectedSlot as ImplantSlotName, pendingGear.id);
                    setSelectedSlot(null);
                    addNotification(
                        'success',
                        `Equipped ${IMPLANT_SLOTS[selectedSlot].label} on ${ship.name}`
                    );
                    setPendingGear(null);
                }
            } else {
                onEquipGear(ship.id, selectedSlot as GearSlotName, pendingGear.id);
                setSelectedSlot(null);
                addNotification('success', `Equipped ${pendingGear.slot} on ${ship.name}`);
                setPendingGear(null);
            }
        }
    };

    const ShipDisplayComponent = viewMode === 'image' ? ShipDisplayImage : ShipDisplay;

    return (
        <>
            <ShipDisplayComponent
                ship={ship}
                onEdit={onEdit}
                onRemove={onRemove}
                onLockEquipment={onLockEquipment}
                variant={variant}
                onAddToComparison={onAddToComparison}
                isInComparison={isInComparison}
            >
                <div className="p-4 bg-dark">
                    {!expanded ? (
                        <div className="flex justify-between items-center gap-2">
                            <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                                {Object.entries(GEAR_SLOTS).map(([key, _]) => (
                                    <GearSlot
                                        key={key}
                                        slotKey={key as GearSlotName}
                                        gear={
                                            gearLookup[ship.equipment?.[key as GearSlotName] || '']
                                        }
                                        hoveredGear={hoveredGear}
                                        onSelect={setSelectedSlot}
                                        onRemove={(slot) => onRemoveGear(ship.id, slot)}
                                        onHover={onHoverGear}
                                    />
                                ))}
                            </div>
                            {variant === 'extended' && onRemoveImplant && onEquipImplant && (
                                <div className="flex flex-col flex-wrap gap-2 w-fit mx-auto justify-center items-center max-h-[200px]">
                                    {Object.entries(IMPLANT_SLOTS).map(([implant, _]) => (
                                        <GearSlot
                                            key={implant}
                                            slotKey={implant as ImplantSlotName}
                                            gear={getGearPiece(ship.implants?.[implant] || '')}
                                            hoveredGear={hoveredGear}
                                            onSelect={setSelectedSlot}
                                            onRemove={(slot) =>
                                                onRemoveImplant(ship.id, slot as ImplantSlotName)
                                            }
                                            onHover={onHoverGear}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Expanded Gear View */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                {Object.entries(GEAR_SLOTS).map(([key, _]) => {
                                    const gear =
                                        gearLookup[ship.equipment?.[key as GearSlotName] || ''];
                                    if (!gear) return null;
                                    return (
                                        <div key={key} className="flex justify-center">
                                            <GearPieceDisplay gear={gear} mode="compact" small />
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Expanded Implants View */}
                            {variant === 'extended' && onRemoveImplant && onEquipImplant && (
                                <div className="border-t border-dark-lighter pt-4">
                                    <h4 className="text-sm font-semibold mb-3 text-gray-300">
                                        Implants
                                    </h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        {Object.entries(IMPLANT_SLOTS).map(([implant, _]) => {
                                            const gear = getGearPiece(
                                                ship.implants?.[implant] || ''
                                            );
                                            if (!gear) return null;
                                            return (
                                                <div key={implant} className="flex justify-center">
                                                    <GearPieceDisplay
                                                        gear={gear}
                                                        mode="compact"
                                                        small
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2 pt-3 min-h-[36px]">
                        {activeSets.length > 0 && (
                            <div className="relative">
                                <div
                                    ref={gearSetsTooltipRef}
                                    className="flex items-center gap-2"
                                    onMouseEnter={() => setShowGearSets(true)}
                                    onMouseLeave={() => setShowGearSets(false)}
                                >
                                    <span className="text-xs text-gray-400">Gear Sets:</span>
                                    {activeSets.map((setName, index) => (
                                        <img
                                            key={`${setName}-${index}`}
                                            src={GEAR_SETS[setName].iconUrl}
                                            alt={setName}
                                            className="w-5"
                                        />
                                    ))}
                                </div>
                                <Tooltip
                                    isVisible={showGearSets}
                                    className="flex flex-col gap-2 bg-dark border border-dark-lighter p-2 w-48"
                                    targetElement={gearSetsTooltipRef.current}
                                >
                                    {activeSets.map((setName, index) => (
                                        <div key={`${setName}-${index}`}>
                                            <span className="text-sm flex items-center gap-2">
                                                <img
                                                    key={`${setName}-${index}`}
                                                    src={GEAR_SETS[setName].iconUrl}
                                                    alt={setName}
                                                    className="w-5"
                                                />
                                                {GEAR_SETS[setName].name}
                                            </span>
                                            <ul
                                                className={`text-xs ${
                                                    index === activeSets.length - 1
                                                        ? ''
                                                        : 'border-b border-dark-border pb-2'
                                                }`}
                                            >
                                                {GEAR_SETS[setName].description && (
                                                    <li className="bg-dark-lighter p-2">
                                                        {GEAR_SETS[setName].description as string}
                                                    </li>
                                                )}
                                                {GEAR_SETS[setName].stats.map((stat) => (
                                                    <li key={stat.name} className="mb-1">
                                                        <StatDisplay
                                                            key={index}
                                                            stats={[stat]}
                                                            className="p-0 bg-dark-lighter"
                                                            compact
                                                        />
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </Tooltip>
                            </div>
                        )}
                        {Object.values(ship.equipment || {}).length > 0 && (
                            <>
                                {variant === 'extended' && (
                                    <Button
                                        aria-label={
                                            expanded ? 'Collapse gear view' : 'Expand gear view'
                                        }
                                        className="ml-auto"
                                        variant="secondary"
                                        size="xs"
                                        onClick={() => setExpanded(!expanded)}
                                    >
                                        {expanded ? 'Collapse' : 'Expand'}
                                    </Button>
                                )}
                                <Button
                                    aria-label="Unequip all gear"
                                    className={variant !== 'extended' ? 'ml-auto' : ''}
                                    variant="secondary"
                                    size="xs"
                                    onClick={handleUnequipAll}
                                >
                                    Unequip All
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </ShipDisplayComponent>

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
