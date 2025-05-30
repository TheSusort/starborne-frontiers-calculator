import { memo, useMemo, useCallback } from 'react';
import { GearPiece } from '../../types/gear';
import { StatName } from '../../types/stats';
import { GEAR_SETS, GEAR_SLOTS, RARITIES, STATS } from '../../constants';
import { Button, CheckIcon, CloseIcon, EditIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
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
        const { getShipName, getShipFromGearId } = useShips();
        const shipName = gear.shipId ? getShipName(gear.shipId) : getShipFromGearId(gear.id)?.name;

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
                className={`bg-dark shadow-md border ${rarityInfo.borderColor} overflow-hidden flex-grow flex flex-col ${className}`}
            >
                {/* Header */}
                <div
                    className={`px-4 py-2 border-b ${rarityInfo.textColor} ${rarityInfo.borderColor} flex justify-between items-center`}
                >
                    <div>
                        <div className="capitalize flex items-center gap-2">
                            <img
                                src={slotInfo}
                                alt={GEAR_SETS[gear.setBonus].name}
                                className="w-6 h-auto"
                            />
                            <span className="font-secondary">{GEAR_SLOTS[gear.slot].label}</span>
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
                                    title="Edit gear piece"
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
                                    title="Remove gear piece"
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
                                title="Equip gear piece"
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
                        {gear.setBonus && (
                            <div>
                                <div className="text-sm text-gray-400 mb-2">
                                    Set Bonus: {GEAR_SETS[gear.setBonus].name}
                                </div>
                                <StatDisplay stats={GEAR_SETS[gear.setBonus].stats} />
                            </div>
                        )}
                        {shipName && (
                            <span className="text-xxs text-gray-500"> Equipped by: {shipName}</span>
                        )}
                    </div>
                )}
            </div>
        );
    },
    (prevProps, nextProps) => {
        // Compare IDs and display settings
        if (
            prevProps.gear.id !== nextProps.gear.id ||
            prevProps.mode !== nextProps.mode ||
            prevProps.showDetails !== nextProps.showDetails
        ) {
            return false;
        }

        // Compare gear properties
        const prevGear = prevProps.gear;
        const nextGear = nextProps.gear;

        if (
            prevGear.slot !== nextGear.slot ||
            prevGear.level !== nextGear.level ||
            prevGear.stars !== nextGear.stars ||
            prevGear.rarity !== nextGear.rarity ||
            prevGear.setBonus !== nextGear.setBonus ||
            prevGear.shipId !== nextGear.shipId
        ) {
            return false;
        }

        // Compare main stat
        if (
            prevGear.mainStat.name !== nextGear.mainStat.name ||
            prevGear.mainStat.value !== nextGear.mainStat.value ||
            prevGear.mainStat.type !== nextGear.mainStat.type
        ) {
            return false;
        }

        // Compare sub stats
        if (prevGear.subStats.length !== nextGear.subStats.length) {
            return false;
        }

        // If we've passed all the checks, the components are equal
        return true;
    }
);

GearPieceDisplay.displayName = 'GearPieceDisplay';
