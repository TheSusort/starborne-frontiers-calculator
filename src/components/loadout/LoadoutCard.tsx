import React, { useMemo, useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, GearSlotName, RARITIES } from '../../constants';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { GearPieceDisplay } from '../gear/GearPieceDisplay';
import { Modal, ConfirmModal, Button, CloseIcon, CheckIcon, EditIcon } from '../ui';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { useShips } from '../../contexts/ShipsContext';
import { useNotification } from '../../hooks/useNotification';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { StatList } from '../stats/StatList';

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
    const [showConflictConfirm, setShowConflictConfirm] = useState(false);
    const gearLookup = useGearLookup(equipment, getGearPiece);
    const activeSets = useGearSets(equipment, gearLookup);
    const { equipMultipleGear, getShipFromGearId } = useShips();
    const { addNotification } = useNotification();
    const { getEngineeringStatsForShipType } = useEngineeringStats();

    const staleGearSlots = useMemo(
        () => Object.entries(equipment).filter(([, gearId]) => gearId && !getGearPiece(gearId)),
        [equipment, getGearPiece]
    );

    const loadoutStats = useMemo(
        () =>
            calculateTotalStats(
                ship.baseStats,
                equipment,
                getGearPiece,
                ship.refits,
                ship.implants,
                getEngineeringStatsForShipType(ship.type),
                ship.id
            ),
        [ship, equipment, getGearPiece, getEngineeringStatsForShipType]
    );

    const getGearConflicts = () => {
        const conflicts: { slot: string; gearName: string; currentShipName: string }[] = [];
        Object.entries(equipment).forEach(([slot, gearId]) => {
            const gear = getGearPiece(gearId);
            if (!gear) return;
            const currentShip = getShipFromGearId(gearId);
            if (currentShip && currentShip.id !== ship.id) {
                const mainStatLabel = gear.mainStat
                    ? `${gear.mainStat.name} ${gear.slot}`
                    : gear.slot;
                conflicts.push({
                    slot,
                    gearName: mainStatLabel,
                    currentShipName: currentShip.name,
                });
            }
        });
        return conflicts;
    };

    const equipLoadout = () => {
        if (!onEquip) return;

        const gearAssignments = Object.entries(equipment)
            .filter(([, gearId]) => {
                const gear = getGearPiece(gearId);
                if (!gear) {
                    addNotification('error', `Gear piece ${gearId} not found in inventory`);
                    return false;
                }
                return true;
            })
            .map(([slot, gearId]) => ({ slot: slot, gearId }));

        void equipMultipleGear(ship.id, gearAssignments);

        addNotification('success', 'Loadout equipped successfully');
        onEquip();
    };

    const handleEquipLoadout = () => {
        if (!onEquip) return;
        const conflicts = getGearConflicts();
        if (conflicts.length > 0) {
            setShowConflictConfirm(true);
        } else {
            equipLoadout();
        }
    };

    return (
        <>
            {name && (
                <div className="flex justify-between items-center mb-2">
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
                    {staleGearSlots.length > 0 && (
                        <div className="mb-3 px-2 py-1.5 bg-yellow-900/30 border border-yellow-700/50 text-yellow-400 text-xs rounded">
                            {staleGearSlots.length} gear piece
                            {staleGearSlots.length > 1 ? 's' : ''} no longer in inventory
                        </div>
                    )}
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

                        <div className="border-t border-dark-lighter mt-3 pt-3">
                            <StatList stats={loadoutStats.final} />
                        </div>
                    </div>
                </ShipDisplay>
            </Modal>

            <ConfirmModal
                isOpen={showConflictConfirm}
                onClose={() => setShowConflictConfirm(false)}
                onConfirm={() => {
                    equipLoadout();
                    setShowConflictConfirm(false);
                }}
                title="Gear Conflicts"
                confirmLabel="Equip Anyway"
                message={
                    <div className="space-y-2">
                        <p>The following gear will be unequipped from other ships:</p>
                        <ul className="list-disc pl-4 space-y-1 text-sm">
                            {getGearConflicts().map((c) => (
                                <li key={c.slot}>
                                    <span className="text-theme-text">{c.gearName}</span>
                                    {' from '}
                                    <span className="text-theme-text">{c.currentShipName}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                }
            />

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
