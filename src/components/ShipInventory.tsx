import React, { useState } from 'react';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { GEAR_SLOTS, GearSlotName } from '../constants/gearTypes';
import { Modal } from './Modal';
import { GearInventory } from './GearInventory';
import { Tooltip } from './Tooltip';
import { Button } from './ui';
import { useInventory } from '../hooks/useInventory';
import { ShipDisplay } from './ShipDisplay';
import { GEAR_SETS } from '../constants';

interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEdit: (ship: Ship) => void;
    onEquipGear: (shipId: string, slot: GearSlotName, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlotName) => void;
    availableGear: GearPiece[];
}

export const ShipInventory: React.FC<Props> = ({ ships, onRemove, onEdit, onEquipGear, onRemoveGear, availableGear }) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { getGearPiece } = useInventory();

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-200">Ships</h2>

            {ships.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter rounded-lg border-2 border-dashed">
                    No ships created yet
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {ships.map(ship => (
                        <div key={ship.id}>
                            <ShipDisplay
                                ship={ship}
                                onEdit={onEdit}
                                onRemove={onRemove}
                            >
                                {/* Equipment Grid */}
                                <div className="mt-4 p-4 bg-dark rounded-lg border border-dark-border">
                                    <div className="grid grid-cols-3 gap-2">
                                        {Object.entries(GEAR_SLOTS).map(([key, slot]) => (
                                            <div key={key} className="relative flex flex-col items-center">
                                                {ship.equipment[key as GearSlotName] ? (
                                                    <div className="relative">
                                                        <div
                                                            className="w-16 h-16 bg-dark-lighter border border-dark-border relative group cursor-pointer flex items-end justify-center"
                                                            onClick={() => setSelectedSlot(key as GearSlotName)}
                                                            onMouseEnter={() => setHoveredGear(getGearPiece(ship.equipment[key as GearSlotName]!) || null)}
                                                            onMouseLeave={() => setHoveredGear(null)}
                                                        >
                                                            {/* Gear set icon */}
                                                            <div className="absolute top-1 left-1 text-xs text-white font-bold">
                                                                <img src={GEAR_SETS[getGearPiece(ship.equipment[key as GearSlotName]!)?.setBonus || 'none']?.iconUrl}
                                                                    alt={getGearPiece(ship.equipment[key as GearSlotName]!)?.setBonus}
                                                                    className="w-5"
                                                                />
                                                            </div>

                                                            {/* main stat and stars */}
                                                            <div className="text-xs text-white font-bold">
                                                                <span className="text-xs text-gray-400">
                                                                    {getGearPiece(ship.equipment[key as GearSlotName]!)?.mainStat.name}
                                                                    {getGearPiece(ship.equipment[key as GearSlotName]!)?.mainStat.type === 'percentage' ? "%" : ""}
                                                                </span>
                                                            </div>

                                                            <div className="absolute top-1 right-1 text-xs text-gray-400 capitalize text-center text-xs">
                                                                <span className="text-xs text-yellow-400">★ {getGearPiece(ship.equipment[key as GearSlotName]!)?.stars}</span>
                                                            </div>

                                                            {/* Remove Button */}
                                                            <Button
                                                                variant="danger"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onRemoveGear(ship.id, key as GearSlotName);
                                                                }}
                                                                className="absolute -top-2 -right-2 rounded-full px-1 py-1 hidden group-hover:block"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                                </svg>
                                                            </Button>
                                                        </div>
                                                        <Tooltip
                                                            gear={getGearPiece(ship.equipment[key as GearSlotName]!)!}
                                                            isVisible={hoveredGear === getGearPiece(ship.equipment[key as GearSlotName]!)}
                                                        />
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => setSelectedSlot(key as GearSlotName)}
                                                        className="w-16 h-16 bg-dark-lighter border border-dark-border flex items-center justify-center hover:bg-dark-border transition-colors"
                                                    >
                                                        <span className="text-xs text-gray-400 capitalize">equip</span>
                                                    </button>
                                                )}
                                                <div className="text-xs text-gray-400 capitalize text-center mt-1">
                                                    {slot.label}
                                                </div>
                                            </div>
                                        ))}
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
                    ))}
                </div>
            )}
        </div>
    );
};