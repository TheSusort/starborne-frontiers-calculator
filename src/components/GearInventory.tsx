import React from 'react';
import { GearPiece } from '../types/gear';

interface Props {
    inventory: GearPiece[];
    onRemove: (id: string) => void;
}

export const GearInventory: React.FC<Props> = ({ inventory, onRemove }) => {
    // Helper function to get rarity color
    const getRarityColor = (rarity: string) => {
        switch (rarity) {
            case 'rare':
                return 'text-blue-600 bg-blue-50 border-blue-200';
            case 'epic':
                return 'text-purple-600 bg-purple-50 border-purple-200';
            case 'legendary':
                return 'text-yellow-600 bg-yellow-50 border-yellow-200';
            default:
                return 'text-gray-600 bg-gray-50 border-gray-200';
        }
    };

    return (
        <div className="space-y-6">
            <h3 className="text-2xl font-bold text-gray-800">Inventory</h3>
            
            {inventory.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed">
                    No gear pieces added yet
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inventory.map(piece => (
                        <div 
                            key={piece.id} 
                            className="relative bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow duration-200"
                        >
                            {/* Header */}
                            <div className={`px-4 py-2 border-b ${getRarityColor(piece.rarity)} flex justify-between items-center`}>
                                <div className="font-semibold capitalize">
                                    {piece.slot}
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-sm">{piece.stars}</span>
                                    <span className="text-yellow-400">★</span>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-4 space-y-4">
                                {/* Main Stat */}
                                <div className="bg-gray-50 p-3 rounded-md">
                                    <div className="text-sm text-gray-500 mb-1">Main Stat</div>
                                    <div className="font-medium capitalize">
                                        {piece.mainStat.name}: {piece.mainStat.value}
                                        {piece.mainStat.type === 'percentage' ? '%' : ''}
                                    </div>
                                </div>

                                {/* Sub Stats */}
                                {piece.subStats.length > 0 && (
                                    <div>
                                        <div className="text-sm text-gray-500 mb-2">Sub Stats</div>
                                        <ul className="space-y-2">
                                            {piece.subStats.map((stat, index) => (
                                                <li 
                                                    key={index}
                                                    className="flex justify-between items-center bg-gray-50 px-3 py-1.5 rounded"
                                                >
                                                    <span className="capitalize">{stat.name}</span>
                                                    <span className="font-medium">
                                                        {stat.value}{stat.type === 'percentage' ? '%' : ''}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Remove Button */}
                                <button 
                                    onClick={() => onRemove(piece.id)}
                                    className="w-full mt-2 px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors duration-200 flex items-center justify-center gap-2"
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}; 