import React, { useMemo, useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { useInventory } from '../../hooks/useInventory';
import { ShipCard } from './ShipCard';
import { FACTIONS, GearSlotName, RARITIES, SHIP_TYPES, RARITY_ORDER, sortRarities } from '../../constants';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';
import { SortConfig } from '../filters/SortPanel';

interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEdit: (ship: Ship) => void;
    onEquipGear: (shipId: string, slot: GearSlotName, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlotName, showNotification?: boolean) => void;
    availableGear: GearPiece[];
}

export const ShipInventory: React.FC<Props> = ({ ships, onRemove, onEdit, onEquipGear, onRemoveGear, availableGear }) => {
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [selectedFactions, setSelectedFactions] = useState<string[]>([]);
    const [selectedShipTypes, setSelectedShipTypes] = useState<string[]>([]);
    const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [sort, setSort] = useState<SortConfig>({ field: 'id', direction: 'asc' });

    const hasActiveFilters = selectedFactions.length > 0 || selectedShipTypes.length > 0 || selectedRarities.length > 0;

    const filteredInventory = useMemo(() => {
        return ships.filter(ship => {
            const matchesFaction = selectedFactions.length === 0 || selectedFactions.includes(ship.faction);
            const matchesType = selectedShipTypes.length === 0 || selectedShipTypes.includes(ship.type);
            const matchesRarity = selectedRarities.length === 0 || selectedRarities.includes(ship.rarity);
            return matchesFaction && matchesType && matchesRarity;
        });
    }, [ships, selectedFactions, selectedShipTypes, selectedRarities]);

    const uniqueFactions = useMemo(() => {
        const factions = new Set(ships.map(ship => ship.faction));
        return Array.from(factions).sort((a, b) => FACTIONS[a].name.localeCompare(FACTIONS[b].name));
    }, [ships]);

    const uniqueShipTypes = useMemo(() => {
        const shipTypes = new Set(ships.map(ship => ship.type));
        return Array.from(shipTypes).sort((a, b) => SHIP_TYPES[a].name.localeCompare(SHIP_TYPES[b].name));
    }, [ships]);

    const uniqueRarities = useMemo(() => {
        const rarities = new Set(ships.map(ship => ship.rarity));
        return sortRarities(Array.from(rarities));
    }, [ships]);

    const { getGearPiece } = useInventory();

    const filters: FilterConfig[] = [
        {
            id: 'faction',
            label: 'Factions',
            values: selectedFactions,
            onChange: setSelectedFactions,
            options: uniqueFactions.map(faction => ({
                value: faction,
                label: FACTIONS[faction].name
            }))
        },
        {
            id: 'shipType',
            label: 'Ship Type',
            values: selectedShipTypes,
            onChange: setSelectedShipTypes,
            options: uniqueShipTypes.map(shipType => ({
                value: shipType,
                label: SHIP_TYPES[shipType].name
            }))
        },
        {
            id: 'rarity',
            label: 'Rarity',
            values: selectedRarities,
            onChange: setSelectedRarities,
            options: uniqueRarities.map(rarity => ({
                value: rarity,
                label: RARITIES[rarity].label
            }))
        }
    ];

    const sortOptions = [
        { value: 'id', label: 'ID' },
        { value: 'type', label: 'Type' },
        { value: 'faction', label: 'Faction' },
        { value: 'rarity', label: 'Rarity' },
        { value: 'gearCount', label: 'Gear' }
    ];

    const sortedAndFilteredInventory = useMemo(() => {
        const filtered = filteredInventory;
        return [...filtered].sort((a, b) => {
            switch (sort.field) {
                case 'type':
                    return sort.direction === 'asc'
                        ? SHIP_TYPES[a.type].name.localeCompare(SHIP_TYPES[b.type].name)
                        : SHIP_TYPES[b.type].name.localeCompare(SHIP_TYPES[a.type].name);
                case 'faction':
                    return sort.direction === 'asc'
                        ? FACTIONS[a.faction].name.localeCompare(FACTIONS[b.faction].name)
                        : FACTIONS[b.faction].name.localeCompare(FACTIONS[a.faction].name);
                case 'rarity':
                    return sort.direction === 'asc'
                        ? RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
                        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                case 'gearCount':
                    const aCount = Object.values(a.equipment).filter(Boolean).length;
                    const bCount = Object.values(b.equipment).filter(Boolean).length;
                    return sort.direction === 'asc'
                        ? aCount - bCount
                        : bCount - aCount;
                default:
                    return sort.direction === 'asc'
                        ? a.id.localeCompare(b.id)
                        : b.id.localeCompare(a.id);
            }
        });
    }, [filteredInventory, sort]);

    const clearFilters = () => {
        setSelectedFactions([]);
        setSelectedShipTypes([]);
        setSelectedRarities([]);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                {sortedAndFilteredInventory.length > 0 && (
                    <span className="text-sm text-gray-400">
                        Showing {sortedAndFilteredInventory.length} ships
                    </span>
                )}
                <FilterPanel
                    filters={filters}
                    isOpen={isFilterOpen}
                    onToggle={() => setIsFilterOpen(!isFilterOpen)}
                    onClear={clearFilters}
                    hasActiveFilters={hasActiveFilters}
                    sortOptions={sortOptions}
                    sort={sort}
                    setSort={setSort}
                />
            </div>

            {sortedAndFilteredInventory.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter  border-2 border-dashed">
                    {ships.length === 0 ? 'No ships created yet' : 'No matching ships found'}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {sortedAndFilteredInventory.map(ship => (
                            <ShipCard
                                key={ship.id}
                                ship={ship}
                                hoveredGear={hoveredGear}
                                availableGear={availableGear}
                                getGearPiece={getGearPiece}
                                onEdit={onEdit}
                                onRemove={onRemove}
                                onEquipGear={onEquipGear}
                                onRemoveGear={onRemoveGear}
                                onHoverGear={setHoveredGear}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};