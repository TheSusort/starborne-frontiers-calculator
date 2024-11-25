import React, { useState } from 'react';
import { Ship, BaseStats } from '../types/ship';

interface Props {
    onSubmit: (ship: Ship) => void;
}

const initialBaseStats: BaseStats = {
    hp: 0,
    attack: 0,
    defence: 0,
    crit: 0,
    critDamage: 0,
    hacking: 0,
    speed: 0,
};

export const ShipForm: React.FC<Props> = ({ onSubmit }) => {
    const [name, setName] = useState('');
    const [baseStats, setBaseStats] = useState<BaseStats>(initialBaseStats);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const ship: Ship = {
            id: Date.now().toString(),
            name,
            baseStats,
            equipment: {},
        };
        onSubmit(ship);
        // Reset form
        setName('');
        setBaseStats(initialBaseStats);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800">Create New Ship</h2>
            
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
                    Create Ship
                </button>
            </div>
        </form>
    );
}; 