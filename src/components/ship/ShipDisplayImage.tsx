import React, { memo, useMemo } from 'react';
import { RARITIES } from '../../constants';
import { Image } from '../ui/Image';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import {
    ShipDisplayProps,
    ShipHeader,
    ShipActionsDropdown,
    LockEquipmentButton,
    QuickAddButtons,
    ImplantsDisplay,
    ShipStatsDisplay,
    ShipCopiesBadge,
} from './shipDisplayComponents';

export const ShipDisplayImage: React.FC<ShipDisplayProps> = memo(
    ({
        ship,
        variant = 'full',
        onEdit,
        onRemove,
        selected,
        onClick,
        children,
        onLockEquipment,
        onQuickAdd,
        isAdded,
        onAddToComparison,
        isInComparison,
    }) => {
        const { getGearPiece } = useInventory();
        const { getEngineeringStatsForShipType } = useEngineeringStats();

        const statsBreakdown = useMemo(
            () =>
                calculateTotalStats(
                    ship.baseStats,
                    ship.equipment,
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    getEngineeringStatsForShipType(ship.type),
                    ship.id
                ),
            [
                ship.baseStats,
                ship.equipment,
                getGearPiece,
                ship.refits,
                getEngineeringStatsForShipType,
                ship.type,
                ship.implants,
                ship.id,
            ]
        );

        if (variant === 'compact') {
            return (
                <div
                    className={`flex-grow p-3 bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                        selected ? 'border-2' : ''
                    } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}`}
                    onClick={onClick}
                >
                    <ShipHeader ship={ship} variant="compact" />
                    {children}
                </div>
            );
        }

        return (
            <div
                className={`flex flex-col bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                    selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}
                    ship-display-height
                    relative
                    group
                `}
                onClick={onClick}
            >
                {ship.imageKey && (
                    <Image
                        src={`${ship.imageKey}_BigPortrait.jpg`}
                        alt={ship.name}
                        className="mx-auto w-full"
                        imageClassName="mb-[10rem] w-full pb-[133%]"
                        aspectRatio="1/1"
                    />
                )}
                <div
                    className={`bg-dark absolute top-[calc(100%-259px)] left-[-1px] w-[calc(100%+2px)] max-h-[260px] group-hover:max-h-[700px] overflow-hidden z-10 group-hover:z-20 transition-all duration-300 ease-in-out border-x border-b ${RARITIES[ship.rarity || 'common'].borderColor}`}
                >
                    <div
                        className={`px-4 py-2 ${ship.imageKey ? 'border-y' : 'border-b'} ${RARITIES[ship.rarity || 'common'].borderColor} flex justify-between items-center relative`}
                    >
                        <ShipHeader ship={ship} />
                        {(onEdit || onRemove || onLockEquipment || onQuickAdd) && (
                            <div className="flex gap-1">
                                {onLockEquipment && (
                                    <LockEquipmentButton
                                        ship={ship}
                                        onLockEquipment={onLockEquipment}
                                    />
                                )}
                                {!onQuickAdd && (
                                    <ShipActionsDropdown
                                        ship={ship}
                                        onEdit={onEdit}
                                        onRemove={onRemove}
                                        onAddToComparison={onAddToComparison}
                                        isInComparison={isInComparison}
                                    />
                                )}
                                {onQuickAdd && (
                                    <QuickAddButtons
                                        ship={ship}
                                        onQuickAdd={onQuickAdd}
                                        isAdded={isAdded}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {children}

                    <div className="px-4 pb-4 relative flex-grow">
                        <div className="space-y-1 text-sm">
                            {variant === 'full' && (
                                <ImplantsDisplay ship={ship} getGearPiece={getGearPiece} />
                            )}
                            <ShipStatsDisplay variant={variant} statsBreakdown={statsBreakdown} />
                        </div>
                    </div>
                    <ShipCopiesBadge copies={ship.copies} />
                </div>
            </div>
        );
    }
);
ShipDisplayImage.displayName = 'ShipDisplayImage';
