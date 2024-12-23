import React from 'react';
import { GearPiece } from '../../types/gear';
import { StatName } from '../../types/stats';
import { GEAR_SETS, RARITIES, STATS } from '../../constants';
import { Button, CloseIcon, EditIcon } from '../ui';

interface Props {
    gear: GearPiece;
    showDetails?: boolean;
    mode?: 'manage' | 'select';
    onRemove?: (id: string) => void;
    onEdit?: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
}

export const GearPieceDisplay: React.FC<Props> = ({
    gear,
    showDetails = true,
    mode = 'manage',
    onRemove,
    onEdit,
    onEquip
}) => {
    return (
        <div className={`bg-dark shadow-md border ${RARITIES[gear.rarity].borderColor} overflow-hidden flex-grow flex flex-col`}>
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
                <div className="p-4 pb-2 space-y-4 flex-grow">
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
                                        <span className="text-gray-300">{STATS[stat.name as StatName].label}</span>
                                        <span className="font-medium text-gray-200">
                                            {stat.value}{stat.type === 'percentage' ? '%' : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <span className="text-xxs text-gray-500">id: {gear.id}</span>
                    {gear.shipId && (
                        <span className="text-xxs text-gray-500"> shipId: {gear.shipId}</span>
                    )}
                </div>
            )}

            {/* Action Buttons */}
            <div className="p-4 pt-0 mt-auto">
                {mode === 'manage' ? (
                    <div className="flex gap-2">
                        {onEdit && (
                            <Button
                                variant="secondary"
                                size="sm"
                                className="ms-auto"
                                onClick={() => onEdit(gear)}
                            >
                                <EditIcon />
                            </Button>
                        )}
                        {onRemove && (
                            <Button
                                variant="danger"
                                size="sm"
                                onClick={() => onRemove(gear.id)}
                            >
                                <CloseIcon />
                            </Button>
                        )}
                    </div>
                ) : (
                    onEquip && (
                        <Button
                            variant="primary"
                            size="sm"
                            fullWidth
                            onClick={() => onEquip(gear)}
                        >
                            Equip
                        </Button>
                    )
                )}
            </div>
        </div>
    );
};