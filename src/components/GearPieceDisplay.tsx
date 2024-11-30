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
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className={`px-4 py-2 border-b ${getRarityColor(gear.rarity)} flex justify-between items-center`}>
                <div className="font-semibold capitalize flex items-center gap-2">
                    <img src={GEAR_SETS[gear.setBonus].iconUrl} alt={gear.setBonus} className="w-6 h-auto" />
                    {gear.slot}
                </div>
                <div className="flex items-center gap-1">
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
                    <div className="bg-gray-50 p-3 rounded-md">
                        <div className="text-sm text-gray-500 mb-1">Main Stat</div>
                        <div className="font-medium capitalize">
                            {gear.mainStat.name}: {gear.mainStat.value}
                            {gear.mainStat.type === 'percentage' ? '%' : ''}
                        </div>
                    </div>

                    {/* Sub Stats */}
                    {gear.subStats.length > 0 && (
                        <div>
                            <div className="text-sm text-gray-500 mb-2">Sub Stats</div>
                            <ul className="space-y-2">
                                {gear.subStats.map((stat, index) => (
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
                </div>
            )}
        </div>
    );
}; 