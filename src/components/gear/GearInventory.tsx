import React, { useState, useMemo } from 'react';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS, GEAR_SLOTS, IMPLANT_SLOTS, RARITIES, RARITY_ORDER } from '../../constants';
import { GearPieceDisplay } from './GearPieceDisplay';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';
import { sortRarities } from '../../constants/rarities';
import { FilterState, usePersistedFilters } from '../../hooks/usePersistedFilters';
import { Button } from '../ui';
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

    const { getShipName, getShipFromGearId } = useShips();

    const { state, setState, clearFilters } = usePersistedFilters('gear-inventory-filters');

    const hasActiveFilters =
        (state.filters.sets?.length ?? 0) > 0 ||
        (state.filters.types?.length ?? 0) > 0 ||
        (state.filters.rarities?.length ?? 0) > 0 ||
        (state.filters.equipped ?? '') !== '' ||
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
                    ? piece.shipId !== '' && piece.shipId !== undefined
                    : state.filters.equipped === 'unequipped'
                      ? piece.shipId === '' || piece.shipId === undefined
                      : true;

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
                (piece.shipId ? getShipName(piece.shipId) : getShipFromGearId(piece.id)?.name)
                    ?.toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                IMPLANT_SLOTS[piece.slot || '']?.label
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                piece.setBonus
                    ?.toLowerCase()
                    .replace(/_/g, ' ')
                    .includes(searchQuery.toLowerCase());

            return matchesSet && matchesType && matchesRarity && matchesEquipped && matchesSearch;
        });
    }, [inventory, state.filters, searchQuery, getShipName, getShipFromGearId]);

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
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleClearFilters = () => {
        clearFilters();
        setSearchQuery('');
    };

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

                    {totalPages > 1 && (
                        <div className="mt-6 flex justify-center items-center space-x-2">
                            <Button
                                onClick={() => handlePageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                                variant="secondary"
                                size="sm"
                            >
                                Previous
                            </Button>

                            <div className="flex items-center space-x-1">
                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                    .filter((page) => {
                                        return (
                                            page === 1 ||
                                            page === totalPages ||
                                            Math.abs(page - currentPage) <= 1
                                        );
                                    })
                                    .map((page, index, array) => {
                                        const showEllipsis =
                                            index > 0 && array[index - 1] !== page - 1;
                                        return (
                                            <React.Fragment key={page}>
                                                {showEllipsis && <span className="px-2">...</span>}
                                                <Button
                                                    onClick={() => handlePageChange(page)}
                                                    variant={
                                                        currentPage === page
                                                            ? 'primary'
                                                            : 'secondary'
                                                    }
                                                    size="sm"
                                                >
                                                    {page}
                                                </Button>
                                            </React.Fragment>
                                        );
                                    })}
                            </div>

                            <Button
                                onClick={() => handlePageChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                variant="secondary"
                                size="sm"
                            >
                                Next
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
