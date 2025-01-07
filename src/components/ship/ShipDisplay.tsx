import React, { memo, useMemo, useState } from 'react';
import { Ship } from '../../types/ship';
import { SHIP_TYPES, FACTIONS, RARITIES } from '../../constants';
import { Button, CloseIcon, EditIcon, LockIcon, UnlockedLockIcon, InfoIcon } from '../ui';
import { calculateTotalStats } from '../../utils/statsCalculator';
import { useInventory } from '../../hooks/useInventory';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { StatList } from '../stats/StatList';
import { Tooltip } from '../ui/layout/Tooltip';
import { StatBreakdown } from '../stats/StatBreakdown';

interface Props {
    ship: Ship;
    variant?: 'full' | 'compact' | 'extended';
    onEdit?: (ship: Ship) => void;
    onRemove?: (id: string) => void;
    selected?: boolean;
    onClick?: () => void;
    children?: React.ReactNode;
    onLockEquipment?: (ship: Ship) => Promise<void>;
}

const ShipImage = memo(({ iconUrl, name }: { iconUrl: string; name: string }) => (
    <img src={iconUrl} alt={name} className="w-4" />
));
ShipImage.displayName = 'ShipImage';

const Header = memo(({ ship }: { ship: Ship }) => (
    <div>
        <div className="flex items-center gap-1 min-h-[28px]">
            {ship.type && SHIP_TYPES[ship.type] && (
                <ShipImage
                    iconUrl={SHIP_TYPES[ship.type].iconUrl}
                    name={SHIP_TYPES[ship.type].name}
                />
            )}
            {ship.faction && FACTIONS[ship.faction] && (
                <ShipImage
                    iconUrl={FACTIONS[ship.faction].iconUrl}
                    name={FACTIONS[ship.faction].name}
                />
            )}
            <span
                className={`lg:text-xs xl:text-sm font-bold ${RARITIES[ship.rarity || 'common'].textColor}`}
            >
                {ship.name}
            </span>
        </div>

        <div className="flex items-center gap-1">
            {Array.from({ length: 6 }, (_, index) => (
                <span
                    key={index}
                    className={`text-xs tracking-tightest ${index < ship.refits.length ? 'text-yellow-400' : 'text-gray-300'}`}
                >
                    ★
                </span>
            ))}
        </div>
    </div>
));
Header.displayName = 'Header';

export const ShipDisplay: React.FC<Props> = memo(
    ({
        ship,
        variant = 'full',
        onEdit,
        onRemove,
        selected,
        onClick,
        children,
        onLockEquipment,
    }) => {
        const [showStatsBreakdown, setShowStatsBreakdown] = useState(false);
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
                    getEngineeringStatsForShipType(ship.type)
                ),
            [
                ship.baseStats,
                ship.equipment,
                getGearPiece,
                ship.refits,
                ship.implants,
                getEngineeringStatsForShipType,
                ship.type,
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
                    <Header ship={ship} />
                    {children}
                </div>
            );
        }

        return (
            <div
                className={`flex flex-col flex-grow bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                    selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}`}
                onClick={onClick}
            >
                {/* Ship Header */}
                <div
                    className={`px-4 py-2 border-b ${RARITIES[ship.rarity || 'common'].borderColor} flex justify-between items-center`}
                >
                    <Header ship={ship} />
                    {(onEdit || onRemove || onLockEquipment) && (
                        <div className="flex gap-1">
                            {onLockEquipment && (
                                <Button
                                    aria-label={
                                        ship.equipmentLocked ? 'Unlock equipment' : 'Lock equipment'
                                    }
                                    variant="secondary"
                                    size="sm"
                                    onClick={async () => {
                                        try {
                                            await onLockEquipment(ship);
                                        } catch (error) {
                                            console.error('Failed to update lock state:', error);
                                        }
                                    }}
                                >
                                    {ship.equipmentLocked ? <LockIcon /> : <UnlockedLockIcon />}
                                </Button>
                            )}
                            {onEdit && (
                                <Button
                                    aria-label="Edit ship"
                                    variant="secondary"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onEdit(ship);
                                    }}
                                >
                                    <EditIcon />
                                </Button>
                            )}
                            {onRemove && (
                                <Button
                                    aria-label="Remove ship"
                                    variant="danger"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemove(ship.id);
                                    }}
                                >
                                    <CloseIcon />
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                {children}

                <div className="px-4 pt-0 pb-6 relative flex-grow">
                    <div className="space-y-1 text-sm">
                        {variant === 'extended' && (
                            <>
                                {ship.implants && (
                                    <div className="flex justify-between text-gray-300 border-b pb-1 border-dark-lighter">
                                        <span>Implants:</span>
                                        <span>{ship.implants?.length}</span>
                                    </div>
                                )}
                            </>
                        )}
                        <div className="flex items-center justify-between">
                            <div className="flex-grow">
                                <StatList stats={statsBreakdown.final} />
                            </div>
                            <div
                                className="cursor-pointer text-gray-400 hover:text-gray-200 absolute bottom-1 right-1"
                                onMouseEnter={() => setShowStatsBreakdown(true)}
                                onMouseLeave={() => setShowStatsBreakdown(false)}
                            >
                                <InfoIcon />
                            </div>
                        </div>
                        <Tooltip isVisible={showStatsBreakdown}>
                            <StatBreakdown breakdown={statsBreakdown} />
                        </Tooltip>
                    </div>
                </div>
            </div>
        );
    }
);
ShipDisplay.displayName = 'ShipDisplay';
