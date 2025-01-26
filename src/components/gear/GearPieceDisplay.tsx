import { memo, useMemo, useCallback } from 'react';
import { GearPiece } from '../../types/gear';
import { StatName } from '../../types/stats';
import { GEAR_SETS, RARITIES, STATS } from '../../constants';
import { Button, CheckIcon, CloseIcon, EditIcon } from '../ui';
import { useShips } from '../../hooks/useShips';
import { StatDisplay } from '../stats/StatDisplay';

interface Props {
    gear: GearPiece;
    showDetails?: boolean;
    mode?: 'manage' | 'select' | 'full' | 'compact';
    onRemove?: (id: string) => void;
    onEdit?: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
    className?: string;
}

export const GearPieceDisplay = memo(
    ({
        gear,
        showDetails = true,
        mode = 'manage',
        onRemove,
        onEdit,
        onEquip,
        className = '',
    }: Props) => {
        const { getShipById } = useShips();
        const ship = gear.shipId ? getShipById(gear.shipId) : undefined;

        // Memoize computed values
        const slotInfo = useMemo(() => GEAR_SETS[gear.setBonus].iconUrl, [gear.setBonus]);
        const rarityInfo = useMemo(() => RARITIES[gear.rarity], [gear.rarity]);

        const handleRemove = useCallback(() => {
            onRemove?.(gear.id);
        }, [gear.id, onRemove]);

        const handleEdit = useCallback(() => {
            onEdit?.(gear);
        }, [gear, onEdit]);

        const handleEquip = useCallback(() => {
            onEquip?.(gear);
        }, [gear, onEquip]);

        return (
            <div
                className={`bg-dark shadow-md border ${rarityInfo.borderColor} overflow-hidden flex-grow flex flex-col min-w-[230px] ${className}`}
            >
                {/* Header */}
                <div
                    className={`px-4 py-2 border-b ${rarityInfo.textColor} ${rarityInfo.borderColor} flex justify-between items-center`}
                >
                    <div>
                        <div className="capitalize flex items-center gap-2">
                            <img src={slotInfo} alt={gear.setBonus} className="w-6 h-auto" />
                            <span className="font-secondary">{gear.slot}</span>
                        </div>
                        <div className="flex items-center">
                            <span className="text-yellow-400 text-sm">★ {gear.stars}</span>
                            <div className="text-sm ps-3">Lvl {gear.level}</div>
                        </div>
                    </div>
                    {mode === 'manage' ? (
                        <div className="flex gap-2">
                            {onEdit && (
                                <Button
                                    aria-label="Edit gear piece"
                                    variant="secondary"
                                    size="sm"
                                    className="ms-auto"
                                    onClick={handleEdit}
                                >
                                    <EditIcon />
                                </Button>
                            )}
                            {onRemove && (
                                <Button
                                    aria-label="Remove gear piece"
                                    variant="danger"
                                    size="sm"
                                    onClick={handleRemove}
                                >
                                    <CloseIcon />
                                </Button>
                            )}
                        </div>
                    ) : (
                        onEquip && (
                            <Button
                                aria-label="Equip gear piece"
                                variant="primary"
                                size="sm"
                                onClick={handleEquip}
                            >
                                <CheckIcon />
                            </Button>
                        )
                    )}
                </div>

                {showDetails && (
                    <div className="p-4 pb-2 space-y-4 flex-grow">
                        {/* Main Stat */}
                        <div className="bg-dark-lighter p-3">
                            <div className="text-sm text-gray-400 mb-1">Main Stat</div>
                            <div className="font-medium capitalize ">
                                {STATS[gear.mainStat.name as StatName].label}: {gear.mainStat.value}
                                {gear.mainStat.type === 'percentage' ? '%' : ''}
                            </div>
                        </div>

                        {/* Sub Stats */}
                        {gear.subStats.length > 0 && (
                            <div>
                                <div className="text-sm text-gray-400 mb-2">Sub Stats</div>
                                <StatDisplay stats={gear.subStats} />
                            </div>
                        )}
                        {ship && (
                            <span className="text-xxs text-gray-500">
                                {' '}
                                Equipped by: {ship.name}
                            </span>
                        )}
                    </div>
                )}
            </div>
        );
    },
    (prevProps, nextProps) => {
        return (
            prevProps.gear.id === nextProps.gear.id &&
            prevProps.mode === nextProps.mode &&
            prevProps.showDetails === nextProps.showDetails
        );
    }
);

GearPieceDisplay.displayName = 'GearPieceDisplay';
