import React, { useMemo } from 'react';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, RARITIES, RARITY_ORDER } from '../../constants';
import { GearPieceDisplay } from './GearPieceDisplay';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';
import { sortRarities } from '../../constants/rarities';
import { FilterState, usePersistedFilters } from '../../hooks/usePersistedFilters';

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
    mode = 'manage',
}) => {
    const [isFilterOpen, setIsFilterOpen] = React.useState(false);
    const { state, setState, clearFilters } = usePersistedFilters('gear-inventory-filters');

    const hasActiveFilters =
        (state.filters.sets?.length ?? 0) > 0 ||
        (state.filters.types?.length ?? 0) > 0 ||
        (state.filters.rarities?.length ?? 0) > 0 ||
        (state.filters.equipped ?? '') !== '';

    const filteredInventory = useMemo(() => {
        return inventory.filter((piece) => {
            const matchesSet =
                (state.filters.sets?.length ?? 0) === 0 ||
                (state.filters.sets?.includes(piece.setBonus) ?? false);
            const matchesType =
                (state.filters.types?.length ?? 0) === 0 ||
                (state.filters.types?.includes(piece.slot) ?? false);
            const matchesRarity =
                (state.filters.rarities?.length ?? 0) === 0 ||
                (state.filters.rarities?.includes(piece.rarity) ?? false);
            const matchesEquipped =
                state.filters.equipped === 'equipped'
                    ? piece.shipId !== '' && piece.shipId !== undefined
                    : state.filters.equipped === 'unequipped'
                      ? piece.shipId === '' || piece.shipId === undefined
                      : true;

            return matchesSet && matchesType && matchesRarity && matchesEquipped;
        });
    }, [inventory, state.filters]);

    const uniqueSets = useMemo(() => {
        const sets = new Set(inventory.map((piece) => piece.setBonus));
        return Array.from(sets).sort((a, b) => GEAR_SETS[a].name.localeCompare(GEAR_SETS[b].name));
    }, [inventory]);

    const uniqueTypes = useMemo(() => {
        const types = new Set(inventory.map((piece) => piece.slot));
        return Array.from(types).sort((a, b) =>
            GEAR_SLOTS[a].label.localeCompare(GEAR_SLOTS[b].label)
        );
    }, [inventory]);

    const uniqueRarities = useMemo(() => {
        const rarities = new Set(inventory.map((piece) => piece.rarity));
        return sortRarities(Array.from(rarities));
    }, [inventory]);

    const filters: FilterConfig[] = [
        {
            id: 'set',
            label: 'Sets',
            values: state.filters.sets ?? [],
            onChange: (sets) =>
                setState((prev: FilterState) => ({ ...prev, filters: { ...prev.filters, sets } })),
            options: uniqueSets.map((set) => ({
                value: set,
                label: GEAR_SETS[set].name,
            })),
        },
        {
            id: 'type',
            label: 'Slots',
            values: state.filters.types ?? [],
            onChange: (types) =>
                setState((prev: FilterState) => ({ ...prev, filters: { ...prev.filters, types } })),
            options: uniqueTypes.map((type) => ({
                value: type,
                label: GEAR_SLOTS[type].label,
            })),
        },
        {
            id: 'rarity',
            label: 'Rarity',
            values: state.filters.rarities ?? [],
            onChange: (rarities) =>
                setState((prev: FilterState) => ({
                    ...prev,
                    filters: { ...prev.filters, rarities },
                })),
            options: uniqueRarities.map((rarity) => ({
                value: rarity,
                label: RARITIES[rarity].label,
            })),
        },
        {
            id: 'equipped',
            label: 'Equipped',
            values: state.filters.equipped ? [state.filters.equipped] : [],
            onChange: (values) => {
                const equipped = values[0] === state.filters.equipped ? '' : values[0];
                setState((prev: FilterState) => ({
                    ...prev,
                    filters: { ...prev.filters, equipped },
                }));
            },
            options: [
                { value: 'equipped', label: 'Equipped to a ship' },
                { value: 'unequipped', label: 'Not equipped to a ship' },
            ],
        },
    ];

    const sortOptions = [
        { value: 'id', label: 'Date Added' },
        { value: 'setBonus', label: 'Set' },
        { value: 'level', label: 'Level' },
        { value: 'stars', label: 'Stars' },
        { value: 'rarity', label: 'Rarity' },
    ];

    const sortedAndFilteredInventory = useMemo(() => {
        const filtered = filteredInventory.map((item, index) => ({
            ...item,
            originalIndex: index,
        }));
        const sorted = [...filtered].sort((a, b) => {
            switch (state.sort.field) {
                case 'setBonus':
                    return state.sort.direction === 'asc'
                        ? GEAR_SETS[a.setBonus].name.localeCompare(GEAR_SETS[b.setBonus].name)
                        : GEAR_SETS[b.setBonus].name.localeCompare(GEAR_SETS[a.setBonus].name);
                case 'level':
                    return state.sort.direction === 'asc' ? a.level - b.level : b.level - a.level;
                case 'stars':
                    return state.sort.direction === 'asc' ? a.stars - b.stars : b.stars - a.stars;
                case 'rarity':
                    return state.sort.direction === 'asc'
                        ? RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
                        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                default:
                    return state.sort.direction === 'asc'
                        ? a.originalIndex - b.originalIndex
                        : b.originalIndex - a.originalIndex;
            }
        });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return sorted.map(({ originalIndex, ...rest }) => rest);
    }, [filteredInventory, state.sort]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col">
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
                    sort={state.sort}
                    setSort={(sort) => setState((prev: FilterState) => ({ ...prev, sort }))}
                />
            </div>

            {sortedAndFilteredInventory.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                    {inventory.length === 0
                        ? 'No gear pieces added yet'
                        : 'No matching gear pieces found'}
                </div>
            ) : (
                <div
                    className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${mode === 'manage' ? 'xl:grid-cols-4' : ''} gap-4`}
                >
                    {sortedAndFilteredInventory.map((piece) => (
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
            )}
        </div>
    );
};
