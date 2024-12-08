import React, { memo, useMemo } from 'react';
import { Ship } from '../../types/ship';
import { SHIP_TYPES, FACTIONS, RARITIES } from '../../constants';
import { Button } from '../ui';
import { CloseIcon } from '../ui/CloseIcon';
import { calculateTotalStats } from '../../utils/statsCalculator';
import { useInventory } from '../../hooks/useInventory';

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
    <div className="flex items-center gap-2">
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
        <span className="font-bold text-gray-200">{ship.name}</span>
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
    const totalStats = useMemo(() => calculateTotalStats(ship.baseStats, ship.equipment, getGearPiece, ship.refits, ship.implants), [ship.baseStats, ship.equipment, getGearPiece, ship.refits, ship.implants]);

    if (variant === 'compact') {
        return (
            <div
                className={`p-3 bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${selected ? 'border-2' : ''
                    } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}`}
                onClick={onClick}
            >
                <Header ship={ship} />
            </div>
        );
    }

    return (
        <div
            className={`bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}`}
            onClick={onClick}
        >
            {/* Ship Header */}
            <div className={`px-4 py-2 bg-dark-lighter border-b ${RARITIES[ship.rarity || 'common'].borderColor} flex justify-between items-center`}>
                <Header ship={ship} />
                {(onEdit || onRemove) && (
                    <div className="flex gap-2">
                        {onEdit && (
                            <Button
                                variant="secondary"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEdit(ship);
                                }}
                            >
                                Edit
                            </Button>
                        )}
                        {onRemove && (
                            <Button
                                variant="danger"
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
                            {ship.refits && (
                                <div className="flex justify-between text-gray-300">
                                    <span>Refits:</span>
                                    <span>{ship.refits?.length}</span>
                                </div>
                            )}
                            {ship.implants && (
                                <div className="flex justify-between text-gray-300 border-b pb-1 border-dark-lighter">
                                    <span>Implants:</span>
                                    <span>{ship.implants?.length}</span>
                                </div>
                            )}
                        </>
                    )}
                    {Object.entries(totalStats).map(([stat, value]) => {
                        return (stat !== 'healModifier' || (stat === 'healModifier' && value !== 0)) && (
                            <div key={stat} className="flex justify-between text-gray-300">
                                <span className="capitalize">{stat}:</span>
                                <div>
                                    <span>{Math.round((value) * 100) / 100}</span>
                                    {['crit', 'critDamage'].includes(stat) ? "%" : ""}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});