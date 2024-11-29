import React from 'react';
import { Ship } from '../types/ship';
import { GearPiece, GearSlot } from '../types/gear';
import { GEAR_SETS } from '../constants/gearSets';

interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEdit: (ship: Ship) => void;
    onEquipGear: (shipId: string, slot: GearSlot, gear: GearPiece) => void;
    onRemoveGear: (shipId: string, slot: GearSlot) => void;
    availableGear: GearPiece[];
}

const formatGearDisplay = (gear: GearPiece | undefined) => {
    if (!gear) return '';
    const setName = gear.setBonus ? GEAR_SETS[gear.setBonus]?.name || 'Unknown Set' : '';
    return `${gear.stars}★ lvl ${gear.level ? gear.level : '??'} ${gear.rarity} ${setName} ${gear.mainStat.name} ${gear.mainStat.value}${gear.mainStat.type === 'percentage' ? '%' : ''}`;
};

export const ShipInventory: React.FC<Props> = ({ ships, onRemove, onEdit, onEquipGear, onRemoveGear, availableGear }) => {
    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Ships</h2>
            
            {ships.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed">
                    No ships created yet
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {ships.map(ship => (
                        <div 
                            key={ship.id}
                            className="bg-white rounded-lg shadow-md overflow-hidden"
                        >
                            {/* Ship Header */}
                            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                                <h3 className="text-xl font-bold text-gray-800">{ship.name}</h3>
                            </div>

                            {/* Total Stats (with equipment) */}
                            <div className="p-6 border-b border-gray-200 bg-gray-50">
                                <h4 className="text-sm font-medium text-gray-500 mb-4">Total Stats</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {Object.entries(ship.stats || ship.baseStats).map(([stat, value]) => (
                                        <div key={stat} className="text-sm">
                                            <span className="text-gray-500 capitalize">{stat}:</span>
                                            <span className="ml-2 font-medium text-blue-600">
                                                {Math.round(value * 100) / 100}
                                                {['crit', 'critDamage', 'healModifier'].includes(stat) ? '%' : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Equipment */}
                            <div className="p-6">
                                <h4 className="text-sm font-medium text-gray-500 mb-4">Equipment</h4>
                                <div className="space-y-4">
                                    {(['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as GearSlot[]).map(slot => (
                                        <div key={slot} className="flex items-center justify-between">
                                            <span className="capitalize text-sm text-gray-700">{slot}</span>
                                            {ship.equipment[slot] ? (
                                                <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                                    {formatGearDisplay(ship.equipment[slot])}
                                                    {ship.equipment[slot]?.subStats.map(stat => 
                                                        `${stat.name}: ${stat.value}${stat.type === 'percentage' ? '%' : ''}`
                                                    ).join(' ')}

                                                    <button
                                                        onClick={() => onRemoveGear(ship.id, slot)}
                                                        className="text-sm text-red-600 hover:text-red-700"
                                                    >
                                                        <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" data-slot="icon">
                                                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            ) : (
                                                <select
                                                    className="text-sm px-3 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    onChange={(e) => {
                                                        const gear = availableGear.find(g => g.id === e.target.value);
                                                        if (gear) onEquipGear(ship.id, slot, gear);
                                                    }}
                                                    value=""
                                                >
                                                    <option value="">Empty</option>
                                                    {availableGear
                                                        .filter(gear => gear.slot === slot)
                                                        .map(gear => (
                                                            <option key={gear.id} value={gear.id}>
                                                                {formatGearDisplay(gear)}
                                                            </option>
                                                        ))
                                                    }
                                                </select>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Remove Button */}
                            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => onEdit(ship)}
                                        className="w-full px-4 py-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors duration-200"
                                    >
                                        Edit Ship
                                    </button>
                                    <button
                                        onClick={() => onRemove(ship.id)}
                                        className="w-full px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors duration-200"
                                    >
                                        Remove Ship
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}; 