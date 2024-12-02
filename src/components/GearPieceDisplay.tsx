import React from 'react';
import { GearPiece } from '../types/gear';
import { GEAR_SETS } from '../constants/gearSets';

interface Props {
    gear: GearPiece;
    showDetails?: boolean;
}

export const GearPieceDisplay: React.FC<Props> = ({ gear, showDetails = true }) => {
    const getRarityColor = (rarity: string) => {
        switch (rarity) {
            case 'rare':
                return 'text-blue-400 bg-blue-900/50 border-blue-800';
            case 'epic':
                return 'text-purple-400 bg-purple-900/50 border-purple-800';
            case 'legendary':
                return 'text-yellow-400 bg-yellow-900/50 border-yellow-800';
            default:
                return 'text-gray-400 bg-dark/50 border-gray-800';
        }
    };

    return (
        <div className="bg-dark rounded-lg shadow-md border border-gray-700 overflow-hidden flex-grow">
            {/* Header */}
            <div className={`px-4 py-2 border-b ${getRarityColor(gear.rarity)} flex justify-between items-center`}>
                <div className="font-semibold capitalize flex items-center gap-2">
                    <img src={GEAR_SETS[gear.setBonus].iconUrl} alt={gear.setBonus} className="w-6 h-auto" />
                    <span className="text-gray-200">{gear.slot}</span>
                </div>
                <div className="flex items-center gap-1 text-gray-200">
                    <span className="text-sm">{gear.stars}</span>
                    <span className="text-yellow-400">★</span>
                    <div className="text-sm ps-3">
                        Lvl {gear.level}
                    </div>
                </div>
            </div>

            {showDetails && (
                <div className="p-4 space-y-4">
                    {/* Main Stat */}
                    <div className="bg-dark-lighter p-3 rounded-md">
                        <div className="text-sm text-gray-400 mb-1">Main Stat</div>
                        <div className="font-medium capitalize text-gray-200">
                            {gear.mainStat.name}: {gear.mainStat.value}
                            {gear.mainStat.type === 'percentage' ? '%' : ''}
                        </div>
                    </div>

                    {/* Sub Stats */}
                    {gear.subStats.length > 0 && (
                        <div>
                            <div className="text-sm text-gray-400 mb-2">Sub Stats</div>
                            <ul className="space-y-2">
                                {gear.subStats.map((stat, index) => (
                                    <li 
                                        key={index}
                                        className="flex justify-between items-center bg-dark-lighter px-3 py-1.5 rounded"
                                    >
                                        <span className="capitalize text-gray-300">{stat.name}</span>
                                        <span className="font-medium text-gray-200">
                                            {stat.value}{stat.type === 'percentage' ? '%' : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}; 