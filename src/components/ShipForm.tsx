import React, { useState, useEffect } from 'react';
import { Ship, BaseStats } from '../types/ship';

interface Props {
    onSubmit: (ship: Ship) => void;
    editingShip?: Ship;
}

const initialBaseStats: BaseStats = {
    hp: 0,
    attack: 0,
    defence: 0,
    crit: 0,
    critDamage: 0,
    hacking: 0,
    speed: 0,
    security: 0,
    healModifier: 0,
};

export const ShipForm: React.FC<Props> = ({ onSubmit, editingShip }) => {
    const [name, setName] = useState(editingShip?.name || '');
    const [baseStats, setBaseStats] = useState<BaseStats>(editingShip?.baseStats || initialBaseStats);

    useEffect(() => {
        if (editingShip) {
            setName(editingShip.name);
            setBaseStats(editingShip.baseStats);
        }
    }, [editingShip]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const ship: Ship = {
            id: editingShip?.id || Date.now().toString(),
            name,
            baseStats,
            stats: { ...baseStats },
            equipment: editingShip?.equipment || {}
        };
        onSubmit(ship);
        if (!editingShip) {
            setName('');
            setBaseStats(initialBaseStats);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800">
                {editingShip ? 'Edit Ship' : 'Create New Ship'}
            </h2>
            
            {/* Ship Name */}
            <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                    Ship Name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter ship name"
                />
            </div>

            {/* Base Stats */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-700">Base Stats</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(baseStats).map(([stat, value]) => (
                        <div key={stat} className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 capitalize">
                                {stat}
                            </label>
                            <input
                                type="number"
                                value={value}
                                onChange={(e) => setBaseStats(prev => ({
                                    ...prev,
                                    [stat]: Number(e.target.value)
                                }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                min="0"
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-4">
                <button 
                    type="submit"
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                >
                    {editingShip ? 'Save Changes' : 'Create Ship'}
                </button>
            </div>
        </form>
    );
}; 