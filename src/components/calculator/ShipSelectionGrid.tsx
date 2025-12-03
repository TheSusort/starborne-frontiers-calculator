import React, { useState, useMemo } from 'react';
import { Ship } from '../../types/ship';
import { RARITIES, RARITY_ORDER } from '../../constants';
import { Input } from '../ui/Input';
import { isEventOnlyShip } from '../../utils/recruitmentCalculator';

interface ShipSelectionGridProps {
    ships: Ship[];
    selectedShipNames: Set<string>;
    onToggleSelection: (shipName: string) => void;
    shipsByRarity: Record<string, Ship[]>;
    rarities?: string[];
    headingLevel?: 'h3' | 'h4';
    headingSize?: 'text-lg' | 'text-md';
    searchLabel?: string;
    searchPlaceholder?: string;
}

export const ShipSelectionGrid: React.FC<ShipSelectionGridProps> = ({
    selectedShipNames,
    onToggleSelection,
    shipsByRarity,
    rarities = RARITY_ORDER,
    headingLevel = 'h3',
    headingSize = 'text-lg',
    searchLabel = 'Search Ships',
    searchPlaceholder = 'Type to search ships...',
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const HeadingTag = headingLevel;

    // Filter ships by search query
    const filteredShipsByRarity = useMemo(() => {
        if (!searchQuery) {
            return shipsByRarity;
        }
        const query = searchQuery.toLowerCase();
        const filtered: Record<string, Ship[]> = {};
        Object.keys(shipsByRarity).forEach((rarity) => {
            const filteredShips = shipsByRarity[rarity].filter((ship) =>
                ship.name.toLowerCase().includes(query)
            );
            if (filteredShips.length > 0) {
                filtered[rarity] = filteredShips;
            }
        });
        return filtered;
    }, [shipsByRarity, searchQuery]);

    // Filter and sort rarities to maintain RARITY_ORDER order
    const orderedRarities = RARITY_ORDER.filter((rarity) => rarities.includes(rarity));

    return (
        <>
            <div className="pb-3">
                <Input
                    label={searchLabel}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="max-w-xs"
                />
            </div>
            <div className="space-y-4 max-h-96 overflow-y-auto">
                {orderedRarities.map((rarity) => {
                    const ships = filteredShipsByRarity[rarity] || [];
                    if (ships.length === 0) return null;

                    const rarityInfo = RARITIES[rarity];
                    return (
                        <div key={rarity} className="space-y-2">
                            <HeadingTag
                                className={`${headingSize} font-semibold ${rarityInfo.textColor}`}
                            >
                                {rarityInfo.label} ({ships.length} ships)
                            </HeadingTag>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                {ships.map((ship) => {
                                    const isSelected = selectedShipNames.has(ship.name);
                                    const isEventOnly = isEventOnlyShip(ship.name);
                                    return (
                                        <button
                                            key={ship.name}
                                            type="button"
                                            onClick={() => onToggleSelection(ship.name)}
                                            className={`
                                                p-2 text-sm border
                                                transition-colors duration-150
                                                ${
                                                    isSelected
                                                        ? `${rarityInfo.bgColor} ${rarityInfo.borderColor} text-dark`
                                                        : 'bg-dark-lighter border-dark-border hover:border-primary'
                                                }
                                            `}
                                        >
                                            {ship.name}
                                            {isEventOnly && (
                                                <span
                                                    className={`
                                                        ${isSelected ? 'text-dark' : 'text-primary'}
                                                        ml-1
                                                    `}
                                                >
                                                    *
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};
