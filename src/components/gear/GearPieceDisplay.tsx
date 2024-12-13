import React from 'react';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, RARITIES } from '../../constants';
import { StatName } from '../../types/stats';
import { STATS } from '../../constants/stats';
interface Props {
    gear: GearPiece;
    showDetails?: boolean;
}

export const GearPieceDisplay: React.FC<Props> = ({ gear, showDetails = true }) => {

    return (
        <div className={`bg-dark shadow-md border ${RARITIES[gear.rarity].borderColor} overflow-hidden flex-grow`}>
            {/* Header */}
            <div className={`px-4 py-2 border-b ${RARITIES[gear.rarity].textColor} ${RARITIES[gear.rarity].borderColor} bg-dark-lighter flex justify-between items-center`}>
                <div className="font-semibold capitalize flex items-center gap-2">
                    <img src={GEAR_SETS[gear.setBonus].iconUrl} alt={gear.setBonus} className="w-6 h-auto" />
                    <span>{gear.slot}</span>
                </div>
                <div className="flex items-center">
                    <span className="text-yellow-400 text-sm">★ {gear.stars}</span>
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
                            {STATS[gear.mainStat.name as StatName].label}: {gear.mainStat.value}
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
                                        <span className="capitalize text-gray-300">{STATS[stat.name as StatName].label}</span>
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