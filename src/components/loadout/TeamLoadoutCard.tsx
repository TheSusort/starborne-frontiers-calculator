import React, { useState } from 'react';
import { TeamLoadout } from '../../types/loadout';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { Button, Modal } from '../ui';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearSlot } from '../gear/GearSlot';
import { GearInventory } from '../gear/GearInventory';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import { useShips } from '../../hooks/useShips';
import { GearSlotName, GEAR_SETS, GEAR_SLOTS, RARITIES } from '../../constants';

interface TeamLoadoutCardProps {
    teamLoadout: TeamLoadout;
    ships: Ship[];
    availableGear: GearPiece[];
    getGearPiece: (id: string) => GearPiece | undefined;
    onUpdate: (id: string, shipLoadouts: TeamLoadout['shipLoadouts']) => void;
    onDelete: (id: string) => void;
}

export const TeamLoadoutCard: React.FC<TeamLoadoutCardProps> = ({
    teamLoadout,
    ships,
    availableGear,
    getGearPiece,
    onUpdate,
    onDelete,
}) => {
    const [selectedSlot, setSelectedSlot] = useState<{ position: number; slot: GearSlotName } | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { handleEquipGear } = useShips();

    const handleEquipGearToShip = (position: number, slot: GearSlotName, gearId: string) => {
        const newShipLoadouts = [...teamLoadout.shipLoadouts];
        const loadoutIndex = newShipLoadouts.findIndex(l => l.position === position);
        
        if (loadoutIndex !== -1) {
            newShipLoadouts[loadoutIndex] = {
                ...newShipLoadouts[loadoutIndex],
                equipment: {
                    ...newShipLoadouts[loadoutIndex].equipment,
                    [slot]: gearId,
                },
            };
            
            try {
                onUpdate(teamLoadout.id, newShipLoadouts);
                setSelectedSlot(null);
            } catch (error) {
                // Handle duplicate gear error
                alert(error instanceof Error ? error.message : 'An error occurred');
            }
        }
    };

    const handleEquipTeam = () => {
        teamLoadout.shipLoadouts.forEach(shipLoadout => {
            Object.entries(shipLoadout.equipment).forEach(([slot, gearId]) => {
                handleEquipGear(shipLoadout.shipId, slot as GearSlotName, gearId);
            });
        });
    };

    return (
        <div className="bg-dark p-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-200">{teamLoadout.name}</h3>
                <div className="flex gap-2">
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleEquipTeam}
                    >
                        Equip Team
                    </Button>
                    <Button
                        variant="danger"
                        size="sm"
                        onClick={() => onDelete(teamLoadout.id)}
                    >
                        Delete
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {teamLoadout.shipLoadouts.map((shipLoadout) => {
                    const ship = ships.find(s => s.id === shipLoadout.shipId);
                    if (!ship) return null;

                    const gearLookup = useGearLookup(shipLoadout.equipment, getGearPiece);
                    const activeSets = useGearSets(shipLoadout.equipment, gearLookup);

                    return (
                        <div key={shipLoadout.position} className="bg-dark-lighter p-4">
                            <div className="mb-2 text-sm text-gray-400">
                                Position {shipLoadout.position}
                            </div>
                            
                            <ShipDisplay ship={ship} variant="compact">
                                <div className={`p-4 mt-3 -mx-3 bg-dark border-t ${RARITIES[ship.rarity || 'common'].borderColor}`}>
                                    <div className="grid grid-cols-3 gap-2 w-fit mx-auto">
                                        {Object.entries(GEAR_SLOTS).map(([key, slot]) => (
                                            <GearSlot
                                                key={key}
                                                slotKey={key as GearSlotName}
                                                slotData={slot}
                                                gear={gearLookup[shipLoadout.equipment[key as GearSlotName] || '']}
                                                hoveredGear={hoveredGear}
                                                onSelect={(slotKey) => setSelectedSlot({ 
                                                    position: shipLoadout.position, 
                                                    slot: slotKey 
                                                })}
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
                        </div>
                    );
                })}
            </div>

            <Modal
                isOpen={selectedSlot !== null}
                onClose={() => setSelectedSlot(null)}
                title={`Select ${selectedSlot?.slot} for Position ${selectedSlot?.position}`}
            >
                <GearInventory
                    inventory={availableGear.filter(gear => 
                        selectedSlot && gear.slot === selectedSlot.slot
                    )}
                    mode="select"
                    onEquip={(gear) => {
                        if (selectedSlot) {
                            handleEquipGearToShip(
                                selectedSlot.position,
                                selectedSlot.slot,
                                gear.id
                            );
                        }
                    }}
                    onRemove={() => {}}
                    onEdit={() => {}}
                />
            </Modal>
        </div>
    );
}; 