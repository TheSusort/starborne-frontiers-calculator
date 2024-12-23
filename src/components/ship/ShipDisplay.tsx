import React, { memo, useMemo } from 'react';
import { Ship } from '../../types/ship';
import { SHIP_TYPES, FACTIONS, RARITIES } from '../../constants';
import { Button, CloseIcon, EditIcon } from '../ui';
import { calculateTotalStats } from '../../utils/statsCalculator';
import { useInventory } from '../../hooks/useInventory';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { StatList } from '../stats/StatList';

interface Props {
    ship: Ship;
    variant?: 'full' | 'compact' | 'extended';
    onEdit?: (ship: Ship) => void;
    onRemove?: (id: string) => void;
    selected?: boolean;
    onClick?: () => void;
    children?: React.ReactNode;
}

const ShipImage = memo(({ iconUrl, name }: { iconUrl: string, name: string }) => (
    <img src={iconUrl} alt={name} className="w-5" />
));

const Header = memo(({ ship }: { ship: Ship }) => (
    <div>
        <div className="flex items-center gap-2 min-h-[28px]">
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
            <span className={`font-bold ${RARITIES[ship.rarity || 'common'].textColor}`}>{ship.name}</span>
        </div>

        <div className="flex items-center gap-1">
            {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className={`text-xs tracking-tightest ${index < ship.refits.length ? 'text-yellow-400' : 'text-gray-300'}`}>
                    ★
                </span>
            ))}
        </div>
    </div>
));

export const ShipDisplay: React.FC<Props> = memo(({
    ship,
    variant = 'full',
    onEdit,
    onRemove,
    selected,
    onClick,
    children
}) => {
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const totalStats = useMemo(() => calculateTotalStats(ship.baseStats, ship.equipment, getGearPiece, ship.refits, ship.implants, getEngineeringStatsForShipType(ship.type)), [ship.baseStats, ship.equipment, getGearPiece, ship.refits, ship.implants, getEngineeringStatsForShipType, ship.type]);

    if (variant === 'compact') {
        return (
            <div
                className={`flex-grow p-3 bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${selected ? 'border-2' : ''
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
            className={`flex-grow bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}`}
            onClick={onClick}
        >
            {/* Ship Header */}
            <div className={`px-4 py-2 border-b ${RARITIES[ship.rarity || 'common'].borderColor} flex justify-between items-center`}>
                <Header ship={ship} />
                {(onEdit || onRemove) && (
                    <div className="flex gap-2">
                        {onEdit && (
                            <Button
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

            <div className="p-4">
                {/* Stats */}
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
                    <StatList stats={totalStats} />
                </div>
            </div>
        </div>
    );
});