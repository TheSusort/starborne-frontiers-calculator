import React, { useState, useMemo } from 'react';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, IMPLANT_SLOTS, RARITIES, RARITY_ORDER } from '../../constants';
import { GearPieceDisplay } from './GearPieceDisplay';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';
import { sortRarities } from '../../constants/rarities';
import { FilterState, usePersistedFilters, StatFilter } from '../../hooks/usePersistedFilters';
import { Pagination } from '../ui';
import { SortConfig } from '../filters/SortPanel';
import { useShips } from '../../contexts/ShipsContext';

const ITEMS_PER_PAGE = 48;

interface Props {
    inventory: GearPiece[];
    onRemove: (id: string) => void;
    onEdit: (piece: GearPiece) => void;
    onEquip?: (piece: GearPiece) => void;
    mode?: 'manage' | 'select';
    maxItems?: number;
}

export const GearInventory: React.FC<Props> = ({
    inventory,
    onRemove,
    onEdit,
    onEquip,
    mode = 'manage',
    maxItems,
}) => {
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');

    const { getShipFromGearId, gearToShipMap } = useShips();

    // Memoize ship names for gear pieces to avoid repeated lookups during search
    const gearToShipNames = useMemo(() => {
        const shipNames = new Map<string, string>();
        gearToShipMap.forEach((shipId, gearId) => {
            const ship = getShipFromGearId(gearId);
            if (ship?.name) {
                shipNames.set(gearId, ship.name);
            }
        });
        return shipNames;
    }, [gearToShipMap, getShipFromGearId]);

    const { state, setState, clearFilters } = usePersistedFilters('gear-inventory-filters');

    const hasActiveFilters =
        (state.filters.sets?.length ?? 0) > 0 ||
        (state.filters.types?.length ?? 0) > 0 ||
        (state.filters.rarities?.length ?? 0) > 0 ||
        (state.filters.equipped ?? '') !== '' ||
        (state.filters.levelRange &&
            (state.filters.levelRange.min > 0 || state.filters.levelRange.max > 0)) ||
        (state.filters.statFilters && state.filters.statFilters.length > 0) ||
        searchQuery.length > 0;

    const filteredInventory = useMemo(() => {
        return inventory.filter((piece) => {
            const matchesSet =
                (state.filters.sets?.length ?? 0) === 0 ||
                (state.filters.sets?.includes(piece.setBonus || '') ?? false);
            const matchesType =
                (state.filters.types?.length ?? 0) === 0 ||
                (state.filters.types?.includes(piece.slot) ?? false);
            const matchesRarity =
                (state.filters.rarities?.length ?? 0) === 0 ||
                (state.filters.rarities?.includes(piece.rarity) ?? false);
            const matchesEquipped =
                state.filters.equipped === 'equipped'
                    ? gearToShipMap.has(piece.id)
                    : state.filters.equipped === 'unequipped'
                      ? !gearToShipMap.has(piece.id)
                      : true;

            // Level range filtering
            const matchesLevelRange =
                !state.filters.levelRange ||
                (state.filters.levelRange.min === 0 && state.filters.levelRange.max === 0) ||
                (piece.level >= (state.filters.levelRange.min || 0) &&
                    piece.level <= (state.filters.levelRange.max || 999));

            // Stat filtering
            const matchesStatFilters =
                !state.filters.statFilters ||
                state.filters.statFilters.length === 0 ||
                state.filters.statFilters.every((statFilter) => {
                    const allStats = [
                        ...(piece.mainStat ? [piece.mainStat] : []),
                        ...piece.subStats,
                    ];

                    // Check if gear has the specified stat with the specified type
                    return allStats.some(
                        (stat) =>
                            stat.name === statFilter.statName && stat.type === statFilter.statType
                    );
                });

            const matchesSearch =
                searchQuery === '' ||
                GEAR_SLOTS[piece.slot]?.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                GEAR_SETS[piece.setBonus || '']?.name
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                RARITIES[piece.rarity].label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                piece.mainStat?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                piece.subStats.some(
                    (stat) =>
                        stat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        stat.value.toString().includes(searchQuery)
                ) ||
                (gearToShipMap.has(piece.id) &&
                    gearToShipNames.has(piece.id) &&
                    gearToShipNames
                        .get(piece.id)
                        ?.toLowerCase()
                        .includes(searchQuery.toLowerCase())) ||
                IMPLANT_SLOTS[piece.slot || '']?.label
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                piece.setBonus
                    ?.toLowerCase()
                    .replace(/_/g, ' ')
                    .includes(searchQuery.toLowerCase());

            return (
                matchesSet &&
                matchesType &&
                matchesRarity &&
                matchesEquipped &&
                matchesLevelRange &&
                matchesStatFilters &&
                matchesSearch
            );
        });
    }, [inventory, state.filters, searchQuery, gearToShipMap, gearToShipNames]);

    const sortedInventory = useMemo(() => {
        return [...filteredInventory].sort((a, b) => {
            switch (state.sort.field) {
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
                        ? a.id.localeCompare(b.id)
                        : b.id.localeCompare(a.id);
            }
        });
    }, [filteredInventory, state.sort]);

    const totalPages = Math.ceil(sortedInventory.length / ITEMS_PER_PAGE);
    const visibleItems = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        return sortedInventory.slice(start, end);
    }, [sortedInventory, currentPage]);

    React.useEffect(() => {
        setCurrentPage(1);
    }, [state.filters, state.sort, searchQuery]);

    const uniqueSets = useMemo(() => {
        const sets = new Set(
            inventory.map((piece) =>
                piece.setBonus && GEAR_SETS[piece.setBonus] ? piece.setBonus : null
            )
        );
        return Array.from(sets).sort((a, b) =>
            GEAR_SETS[a || '']?.name.localeCompare(GEAR_SETS[b || '']?.name)
        );
    }, [inventory]);

    const uniqueTypes = useMemo(() => {
        const types = new Set(inventory.map((piece) => piece.slot));
        return Array.from(types).sort((a, b) =>
            GEAR_SLOTS[a || '']?.label.localeCompare(GEAR_SLOTS[b || '']?.label)
        );
    }, [inventory]);

    const uniqueRarities = useMemo(() => {
        const rarities = new Set(inventory.map((piece) => piece.rarity));
        return sortRarities(Array.from(rarities));
    }, [inventory]);

    const setSort = (sort: SortConfig) => {
        setState((prev: FilterState) => ({ ...prev, sort }));
    };

    const setLevelRange = (min: number, max: number) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: {
                ...prev.filters,
                levelRange: { min, max },
            },
        }));
    };

    const clearLevelRange = () => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: {
                ...prev.filters,
                levelRange: undefined,
            },
        }));
    };

    const setStatFilters = (statFilters: StatFilter[]) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: {
                ...prev.filters,
                statFilters,
            },
        }));
    };

    const filters: FilterConfig[] = [
        {
            id: 'type',
            label: 'Slots',
            values: state.filters.types ?? [],
            onChange: (types) =>
                setState((prev: FilterState) => ({ ...prev, filters: { ...prev.filters, types } })),
            options: uniqueTypes.map((type) => ({
                value: type,
                label: GEAR_SLOTS[type || '']?.label || IMPLANT_SLOTS[type || '']?.label,
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
            id: 'set',
            label: 'Sets',
            values: state.filters.sets ?? [],
            onChange: (sets) =>
                setState((prev: FilterState) => ({ ...prev, filters: { ...prev.filters, sets } })),
            options: uniqueSets
                .filter((set) => set)
                .map((set) => ({
                    value: set || '',
                    label: GEAR_SETS[set || '']?.name || '',
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
        { value: 'level', label: 'Level' },
        { value: 'stars', label: 'Stars' },
        { value: 'rarity', label: 'Rarity' },
    ];

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleClearFilters = () => {
        clearFilters();
        setSearchQuery('');
    };

    const rangeFilters = [
        {
            id: 'level',
            label: 'Level Range',
            minValue: state.filters.levelRange?.min || 0,
            maxValue: state.filters.levelRange?.max || 0,
            onMinChange: (min: number) => setLevelRange(min, state.filters.levelRange?.max || 0),
            onMaxChange: (max: number) => setLevelRange(state.filters.levelRange?.min || 0, max),
            onClear: clearLevelRange,
            minPlaceholder: 'Min',
            maxPlaceholder: 'Max',
        },
    ];

    const statFilters = [
        {
            id: 'stats',
            label: 'Stat Filters',
            statFilters: state.filters.statFilters || [],
            onStatFiltersChange: setStatFilters,
        },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col">
                {sortedInventory.length > 0 && (
                    <span className="text-sm text-gray-400">
                        Showing {visibleItems.length} of {sortedInventory.length} items
                        {maxItems !== undefined && ` (${maxItems} total)`}
                    </span>
                )}
                <FilterPanel
                    filters={filters}
                    rangeFilters={rangeFilters}
                    statFilters={statFilters}
                    isOpen={isFilterOpen}
                    onToggle={() => setIsFilterOpen(!isFilterOpen)}
                    onClear={handleClearFilters}
                    hasActiveFilters={hasActiveFilters}
                    sortOptions={sortOptions}
                    sort={state.sort}
                    setSort={setSort}
                    searchValue={searchQuery}
                    onSearchChange={setSearchQuery}
                    searchPlaceholder="Search gear..."
                />
            </div>

            {sortedInventory.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                    {inventory.length === 0 ? 'No gear created yet' : 'No matching gear found'}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {visibleItems.map((piece) => (
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

                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                    />
                </>
            )}
        </div>
    );
};
