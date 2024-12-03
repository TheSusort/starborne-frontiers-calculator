import React, { memo } from 'react';
import { Ship } from '../types/ship';
import { SHIP_TYPES } from '../constants/shipTypes';
import { FACTIONS } from '../constants/factions';
import { Button } from './ui';
import { RARITIES } from '../constants';

interface Props {
    ship: Ship;
    variant?: 'full' | 'compact';
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
    if (variant === 'compact') {
        return (
            <div
                className={`p-3 bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                    selected ? 'border-2' : ''
                } ${onClick ? 'cursor-pointer hover:bg-dark-lighter' : ''}`}
                onClick={onClick}
            >
                <Header ship={ship} />
            </div>
        );
    }

    return (
        <div
            className={`bg-dark border ${RARITIES[ship.rarity || 'common'].borderColor} ${
                selected ? 'border-2' : ''
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
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {children}

            <div className="p-4">
                {/* Stats */}
                <div className="space-y-1 text-sm">
                    {Object.entries(ship.stats || ship.baseStats).map(([stat, value]) => {
                        return (stat !== 'healModifier' || (stat === 'healModifier' && value !== 0)) && (
                            <div key={stat} className="flex justify-between text-gray-300">
                                <span className="capitalize">{stat}:</span>
                                <div>
                                    <span>{Math.round(value * 100) / 100}</span>
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