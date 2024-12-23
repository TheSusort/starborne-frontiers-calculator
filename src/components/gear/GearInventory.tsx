import React, { useState, useMemo } from 'react';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, RARITIES, RARITY_ORDER } from '../../constants';
import { GearPieceDisplay } from './GearPieceDisplay';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';
import { sortRarities } from '../../constants/rarities';
import { SortConfig } from '../filters/SortPanel';

interface Props {
    inventory: GearPiece[];
    onRemove: (id: string) => void;
    onEdit: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
    mode?: 'manage' | 'select';
}

export const GearInventory: React.FC<Props> = ({
    inventory,
    onRemove,
    onEdit,
    onEquip,
    mode = 'manage'
}) => {
    const [selectedSets, setSelectedSets] = useState<string[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
    const [selectedEquipped, setSelectedEquipped] = useState<boolean>(false);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [sort, setSort] = useState<SortConfig>({ field: 'id', direction: 'asc' });

    const hasActiveFilters = selectedSets.length > 0 || selectedTypes.length > 0 || selectedRarities.length > 0;

    const filteredInventory = useMemo(() => {
        return inventory.filter(piece => {
            const matchesSet = selectedSets.length === 0 || selectedSets.includes(piece.setBonus);
            const matchesType = selectedTypes.length === 0 || selectedTypes.includes(piece.slot);
            const matchesRarity = selectedRarities.length === 0 || selectedRarities.includes(piece.rarity);
            const matchesEquipped = selectedEquipped ? piece.shipId !== '' && piece.shipId !== undefined : true;

            return matchesSet && matchesType && matchesRarity && matchesEquipped;
        });
    }, [inventory, selectedSets, selectedTypes, selectedRarities, selectedEquipped]);

    const uniqueSets = useMemo(() => {
        const sets = new Set(inventory.map(piece => piece.setBonus));
        return Array.from(sets).sort((a, b) => GEAR_SETS[a].name.localeCompare(GEAR_SETS[b].name));
    }, [inventory]);

    const uniqueTypes = useMemo(() => {
        const types = new Set(inventory.map(piece => piece.slot));
        return Array.from(types).sort((a, b) => GEAR_SLOTS[a].label.localeCompare(GEAR_SLOTS[b].label));
    }, [inventory]);

    const uniqueRarities = useMemo(() => {
        const rarities = new Set(inventory.map(piece => piece.rarity));
        return sortRarities(Array.from(rarities));
    }, [inventory]);

    const filters: FilterConfig[] = [
        {
            id: 'set',
            label: 'Sets',
            values: selectedSets,
            onChange: setSelectedSets,
            options: uniqueSets.map(set => ({
                value: set,
                label: GEAR_SETS[set].name
            }))
        },
        {
            id: 'type',
            label: 'Slots',
            values: selectedTypes,
            onChange: setSelectedTypes,
            options: uniqueTypes.map(type => ({
                value: type,
                label: GEAR_SLOTS[type].label
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
        },
        {
            id: 'equipped',
            label: 'Equipped',
            values: selectedEquipped ? ['equipped'] : [],
            onChange: () => setSelectedEquipped(!selectedEquipped),
            options: [{ value: 'equipped', label: 'Equipped to a ship' }]
        }
    ];

    const sortOptions = [
        { value: 'id', label: 'Date Added' },
        { value: 'setBonus', label: 'Set' },
        { value: 'level', label: 'Level' },
        { value: 'stars', label: 'Stars' },
        { value: 'rarity', label: 'Rarity' }
    ];

    const sortedAndFilteredInventory = useMemo(() => {
        const filtered = filteredInventory;
        return [...filtered].sort((a, b) => {
            switch (sort.field) {
                case 'setBonus':
                    return sort.direction === 'asc'
                        ? GEAR_SETS[a.setBonus].name.localeCompare(GEAR_SETS[b.setBonus].name)
                        : GEAR_SETS[b.setBonus].name.localeCompare(GEAR_SETS[a.setBonus].name);
                case 'level':
                    return sort.direction === 'asc'
                        ? a.level - b.level
                        : b.level - a.level;
                case 'stars':
                    return sort.direction === 'asc'
                        ? a.stars - b.stars
                        : b.stars - a.stars;
                case 'rarity':
                    return sort.direction === 'asc'
                        ? RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
                        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                default:
                    return sort.direction === 'asc'
                        ? b.id.localeCompare(a.id)
                        : a.id.localeCompare(b.id);
            }
        });
    }, [filteredInventory, sort]);

    const clearFilters = () => {
        setSelectedSets([]);
        setSelectedTypes([]);
        setSelectedRarities([]);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                {sortedAndFilteredInventory.length > 0 && (
                    <span className="text-sm text-gray-400">
                        Showing {sortedAndFilteredInventory.length} gear pieces
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

            {
                sortedAndFilteredInventory.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                        {inventory.length === 0 ? 'No gear pieces added yet' : 'No matching gear pieces found'}
                    </div>
                ) : (
                    <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${mode === 'manage' ? 'xl:grid-cols-4' : ''} gap-4`}>
                        {sortedAndFilteredInventory.map(piece => (
                            <GearPieceDisplay
                                key={piece.id}
                                gear={piece}
                                mode={mode}
                                onEdit={onEdit}
                                onRemove={onRemove}
                                onEquip={onEquip}
                            />
                        ))}
                    </div>
                )
            }
        </div>
    );
};