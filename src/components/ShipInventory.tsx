import React from 'react';
import { Ship } from '../types/ship';
import { GearPiece, GearSlot } from '../types/gear';

interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEquipGear: (shipId: string, slot: GearSlot, gear: GearPiece) => void;
    availableGear: GearPiece[];
}

export const ShipInventory: React.FC<Props> = ({ ships, onRemove, onEquipGear, availableGear }) => {
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

                            {/* Base Stats */}
                            <div className="p-6 border-b border-gray-200">
                                <h4 className="text-sm font-medium text-gray-500 mb-4">Base Stats</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {Object.entries(ship.baseStats).map(([stat, value]) => (
                                        <div key={stat} className="text-sm">
                                            <span className="text-gray-500 capitalize">{stat}:</span>
                                            <span className="ml-2 font-medium">{value}</span>
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
                                                <div className="text-sm font-medium text-gray-900">
                                                    {ship.equipment[slot]?.mainStat.name}: {ship.equipment[slot]?.mainStat.value}
                                                    {ship.equipment[slot]?.mainStat.type === 'percentage' ? '%' : ''}
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
                                                                {gear.mainStat.name} {gear.mainStat.value}
                                                                {gear.mainStat.type === 'percentage' ? '%' : ''}
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
                                <button
                                    onClick={() => onRemove(ship.id)}
                                    className="w-full px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors duration-200"
                                >
                                    Remove Ship
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}; 