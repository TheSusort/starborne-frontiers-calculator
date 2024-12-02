import React, { useState } from 'react';
import { Ship } from '../types/ship';
import { GearPiece, GearSlot } from '../types/gear';
import { GEAR_SETS } from '../constants/gearSets';
import { SHIP_TYPES } from '../constants/shipTypes';
import { Modal } from './Modal';
import { GearInventory } from './GearInventory';
import { Tooltip } from './Tooltip';
import { FACTIONS } from '../constants/factions';
import { Button } from './ui/Button';
import { useInventory } from '../hooks/useInventory';

interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEdit: (ship: Ship) => void;
    onEquipGear: (shipId: string, slot: GearSlot, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlot) => void;
    availableGear: GearPiece[];
}

const getRarityColor = (rarity: string) => {
    switch (rarity) {
        case 'rare':
            return 'border-blue-200';
        case 'epic':
            return 'border-purple-200';
        case 'legendary':
            return 'border-yellow-200';
        default:
            return 'border-gray-200';
    }
};

export const ShipInventory: React.FC<Props> = ({ ships, onRemove, onEdit, onEquipGear, onRemoveGear, availableGear }) => {
    const [selectedSlot, setSelectedSlot] = useState<GearSlot | null>(null);
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
                        <div 
                            key={ship.id}
                            className="bg-dark rounded-lg border border-gray-700"
                        >
                            {/* Ship Header */}
                            <div className="px-4 py-2 bg-dark-lighter border-b border-gray-700 flex justify-between items-center">
                                <h3 className="text-lg font-bold text-gray-200 flex items-center gap-2">
                                    {ship.type && SHIP_TYPES[ship.type] && (
                                        <>
                                            <img src={SHIP_TYPES[ship.type].iconUrl} alt={SHIP_TYPES[ship.type].name} className="w-5" />
                                        </>
                                    )}
                                    {ship.faction && FACTIONS[ship.faction] && (
                                        <>
                                            <img src={FACTIONS[ship.faction].iconUrl} alt={FACTIONS[ship.faction].name} className="w-5" />
                                        </>
                                    )}
                                    {ship.name}
                                </h3>
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => onEdit(ship)}
                                    >
                                        Edit
                                    </Button>
                                    <Button
                                        variant="danger"
                                        onClick={() => onRemove(ship.id)}
                                        className="text-red-400 hover:text-red-300"
                                    >
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </Button>
                                </div>
                            </div>

                            <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
                                {/* Equipment Grid */}
                                <div className="grid grid-cols-3 gap-2">
                                    {(['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as GearSlot[]).map(slot => (
                                        <div key={slot} className="relative flex flex-col items-center">
                                            {ship.equipment[slot] ? (
                                                <div className="relative">
                                                    <div 
                                                        className={`w-16 h-16 bg-dark-lighter border ${getRarityColor(getGearPiece(ship.equipment[slot]!)?.rarity || 'common')} relative group cursor-pointer`}
                                                        onClick={() => setSelectedSlot(slot)}
                                                        onMouseEnter={() => setHoveredGear(getGearPiece(ship.equipment[slot]!) || null)}
                                                        onMouseLeave={() => setHoveredGear(null)}
                                                    >
                                                        {/* gear set icon */}
                                                        <div className="absolute top-1 left-1 text-xs text-white font-bold">
                                                            <img src={GEAR_SETS[getGearPiece(ship.equipment[slot]!)?.setBonus || '']?.iconUrl} alt={GEAR_SETS[getGearPiece(ship.equipment[slot]!)?.setBonus || '']?.name} className="w-5" />
                                                        </div>

                                                        {/* Level and Stars */}
                                                        <div className="absolute top-1 right-1 text-xs text-white font-bold">
                                                            {getGearPiece(ship.equipment[slot]!)?.level}
                                                        </div>
                                                        
                                                        <div className="absolute bottom-1 left-1 right-1 text-xs text-gray-400 capitalize text-center text-xs">
                                                            {getGearPiece(ship.equipment[slot]!)?.stars}
                                                            <span className="text-yellow-400">★</span>
                                                        </div>

                                                        {/* Remove Button */}
                                                        <Button
                                                            variant="danger"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onRemoveGear(ship.id, slot);
                                                            }}
                                                            className="absolute -top-2 -right-2 rounded-full px-1 py-1 hidden group-hover:block"
                                                        >
                                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </Button>
                                                    </div>
                                                    <Tooltip 
                                                        gear={getGearPiece(ship.equipment[slot]!)!}
                                                        isVisible={hoveredGear === getGearPiece(ship.equipment[slot]!)}
                                                    />
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setSelectedSlot(slot)}
                                                    className="w-16 h-16 bg-dark-lighter border border-gray-700 flex items-center justify-center hover:bg-gray-700 transition-colors"
                                                >
                                                    <span className="text-xs text-gray-400 capitalize">equip</span>
                                                </button>
                                            )}
                                            <div className="text-xs text-gray-400 capitalize text-center text-xs">
                                                {slot}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Stats */}
                                <div className="space-y-1 text-sm">
                                    {Object.entries(ship.stats || ship.baseStats).map(([stat, value]) => {
                                        return (stat !== 'healModifier' || (stat === 'healModifier' && value !== 0)) && (
                                            <div key={stat} className="flex justify-between text-gray-300">
                                                <span className="capitalize">{stat}:</span>
                                                <div>
                                                    <span>{Math.round(value * 100) / 100}</span>
                                                    {['crit', 'critDamage'].includes(stat) ? "%" : ""}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <Modal
                                isOpen={selectedSlot !== null}
                                onClose={() => setSelectedSlot(null)}
                                title={`Select ${selectedSlot} for ${ship.name}`}
                            >
                                <GearInventory
                                    inventory={availableGear.filter(gear => gear.slot === selectedSlot)}
                                    mode="select"
                                    onEquip={(gear) => {
                                        if (selectedSlot) {
                                            onEquipGear(ship.id, selectedSlot, gear.id);
                                            setSelectedSlot(null);
                                        }
                                    }}
                                    onRemove={() => {}}
                                    onEdit={() => {}}
                                />
                            </Modal>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}; 