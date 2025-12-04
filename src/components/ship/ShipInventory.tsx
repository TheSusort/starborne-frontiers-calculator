import React, { useMemo, useState } from 'react';
import { Ship, AffinityName } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { useInventory } from '../../contexts/InventoryProvider';
import { ShipCard } from './ShipCard';
import {
    FACTIONS,
    GearSlotName,
    RARITIES,
    SHIP_TYPES,
    RARITY_ORDER,
    sortRarities,
    ALL_STAT_NAMES,
} from '../../constants';
import { FilterPanel, FilterConfig } from '../filters/FilterPanel';
import { SortConfig } from '../filters/SortPanel';
import { FilterState, usePersistedFilters } from '../../hooks/usePersistedFilters';
import { usePersistedViewMode } from '../../hooks/usePersistedViewMode';
import { Pagination } from '../ui';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { STATS } from '../../constants/stats';
import { StatName } from '../../types/stats';

const ITEMS_PER_PAGE = 48;

interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEdit: (ship: Ship) => void;
    onEquipGear: (shipId: string, slot: GearSlotName, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlotName, showNotification?: boolean) => void;
    onLockEquipment: (ship: Ship) => Promise<void>;
    onUnequipAll: (shipId: string) => void;
    availableGear: GearPiece[];
}

export const ShipInventory: React.FC<Props> = ({
    ships,
    onRemove,
    onEdit,
    onEquipGear,
    onRemoveGear,
    onLockEquipment,
    onUnequipAll,
    availableGear,
}) => {
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = usePersistedViewMode('ship-inventory-view-mode');

    const { state, setState, clearFilters } = usePersistedFilters('ship-inventory-filters');
    const { getGearPiece } = useInventory();

    const hasActiveFilters =
        (state.filters.factions?.length ?? 0) > 0 ||
        (state.filters.shipTypes?.length ?? 0) > 0 ||
        (state.filters.rarities?.length ?? 0) > 0 ||
        (state.filters.affinities?.length ?? 0) > 0 ||
        state.filters.equipmentLocked ||
        searchQuery.length > 0;

    const setSelectedFactions = (factions: string[]) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: { ...prev.filters, factions },
        }));
    };

    const setSelectedShipTypes = (shipTypes: string[]) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: { ...prev.filters, shipTypes },
        }));
    };

    const setSelectedRarities = (rarities: string[]) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: { ...prev.filters, rarities },
        }));
    };

    const setSelectedAffinities = (affinities: string[]) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: { ...prev.filters, affinities },
        }));
    };

    const setEquipmentLocked = (locked: boolean) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: { ...prev.filters, equipmentLocked: locked },
        }));
    };

    const setSort = (sort: SortConfig) => {
        setState((prev: FilterState) => ({ ...prev, sort }));
    };

    const filteredInventory = useMemo(() => {
        return ships.filter((ship) => {
            const matchesFaction =
                (state.filters.factions?.length ?? 0) === 0 ||
                (state.filters.factions?.includes(ship.faction) ?? false);
            const matchesType =
                (state.filters.shipTypes?.length ?? 0) === 0 ||
                (state.filters.shipTypes?.includes(ship.type) ?? false);
            const matchesRarity =
                (state.filters.rarities?.length ?? 0) === 0 ||
                (state.filters.rarities?.includes(ship.rarity) ?? false);
            const matchesAffinity =
                (state.filters.affinities?.length ?? 0) === 0 ||
                ((ship.affinity && state.filters.affinities?.includes(ship.affinity)) ?? false);
            const matchesEquipmentLocked = !state.filters.equipmentLocked || ship.equipmentLocked;
            const matchesSearch =
                searchQuery === '' ||
                ship.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                SHIP_TYPES[ship.type]?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                FACTIONS[ship.faction]?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                ship.affinity?.toLowerCase().includes(searchQuery.toLowerCase());

            return (
                matchesFaction &&
                matchesType &&
                matchesRarity &&
                matchesAffinity &&
                matchesEquipmentLocked &&
                matchesSearch
            );
        });
    }, [ships, state.filters, searchQuery]);

    const sortedInventory = useMemo(() => {
        const filtered = filteredInventory.filter((ship) => ship !== undefined && ship !== null);
        return [...filtered].sort((a, b) => {
            if (!a || !b) return 0;
            switch (state.sort.field) {
                case 'type':
                    return state.sort.direction === 'asc'
                        ? SHIP_TYPES[a.type]?.name.localeCompare(SHIP_TYPES[b.type]?.name)
                        : SHIP_TYPES[b.type]?.name.localeCompare(SHIP_TYPES[a.type]?.name);
                case 'faction':
                    return state.sort.direction === 'asc'
                        ? FACTIONS[a.faction]?.name.localeCompare(FACTIONS[b.faction]?.name)
                        : FACTIONS[b.faction]?.name.localeCompare(FACTIONS[a.faction]?.name);
                case 'rarity':
                    return state.sort.direction === 'asc'
                        ? RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
                        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                case 'gearCount': {
                    const aCount = Object.values(a.equipment).filter(Boolean).length;
                    const bCount = Object.values(b.equipment).filter(Boolean).length;
                    return state.sort.direction === 'asc' ? aCount - bCount : bCount - aCount;
                }
                case 'name':
                    return state.sort.direction === 'asc'
                        ? (a.name || '').localeCompare(b.name || '')
                        : (b.name || '').localeCompare(a.name || '');
                default:
                    // Handle stat-based sorting
                    if (ALL_STAT_NAMES.includes(state.sort.field as StatName)) {
                        const aStats = calculateTotalStats(
                            a.baseStats,
                            a.equipment,
                            getGearPiece,
                            a.refits,
                            a.implants,
                            undefined // engineering stats
                        );
                        const bStats = calculateTotalStats(
                            b.baseStats,
                            b.equipment,
                            getGearPiece,
                            b.refits,
                            b.implants,
                            undefined // engineering stats
                        );
                        const statName = state.sort.field as StatName;
                        const aValue = aStats.final[statName] || 0;
                        const bValue = bStats.final[statName] || 0;
                        return state.sort.direction === 'asc' ? aValue - bValue : bValue - aValue;
                    }
                    return state.sort.direction === 'asc'
                        ? a.id.localeCompare(b.id)
                        : b.id.localeCompare(a.id);
            }
        });
    }, [filteredInventory, state.sort, getGearPiece]);

    // Calculate pagination
    const totalPages = Math.ceil(sortedInventory.length / ITEMS_PER_PAGE);
    const visibleItems = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        return sortedInventory.slice(start, end);
    }, [sortedInventory, currentPage]);

    // Reset to first page when filters change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [state.filters, state.sort, searchQuery]);

    const uniqueFactions = useMemo(() => {
        const factions = new Set(ships.map((ship) => ship.faction));
        return Array.from(factions).sort((a, b) =>
            FACTIONS[a]?.name.localeCompare(FACTIONS[b]?.name)
        );
    }, [ships]);

    const uniqueShipTypes = useMemo(() => {
        const shipTypes = new Set(ships.map((ship) => ship.type));
        return Array.from(shipTypes).sort((a, b) =>
            SHIP_TYPES[a]?.name.localeCompare(SHIP_TYPES[b]?.name)
        );
    }, [ships]);

    const uniqueRarities = useMemo(() => {
        const rarities = new Set(ships.map((ship) => ship.rarity));
        return sortRarities(Array.from(rarities));
    }, [ships]);

    const uniqueAffinities = useMemo(() => {
        const affinities = new Set(
            ships
                .map((ship) => ship.affinity)
                .filter((affinity): affinity is AffinityName => affinity !== undefined)
        );
        return Array.from(affinities).sort((a, b) => a.localeCompare(b));
    }, [ships]);

    const filters: FilterConfig[] = [
        {
            id: 'faction',
            label: 'Factions',
            values: state.filters.factions ?? [],
            onChange: setSelectedFactions,
            options: uniqueFactions.map((faction) => ({
                value: faction,
                label: FACTIONS[faction]?.name,
            })),
        },
        {
            id: 'shipType',
            label: 'Ship Type',
            values: state.filters.shipTypes ?? [],
            onChange: setSelectedShipTypes,
            options: uniqueShipTypes.map((shipType) => ({
                value: shipType,
                label: SHIP_TYPES[shipType]?.name,
            })),
        },
        {
            id: 'rarity',
            label: 'Rarity',
            values: state.filters.rarities ?? [],
            onChange: setSelectedRarities,
            options: uniqueRarities.map((rarity) => ({
                value: rarity,
                label: RARITIES[rarity]?.label,
            })),
        },
        {
            id: 'affinity',
            label: 'Affinity',
            values: state.filters.affinities ?? [],
            onChange: setSelectedAffinities,
            options: uniqueAffinities.map((affinity) => ({
                value: affinity,
                label: affinity.charAt(0).toUpperCase() + affinity.slice(1),
            })),
        },
        {
            id: 'equipmentLocked',
            label: 'Equipment Lock',
            values: state.filters.equipmentLocked ? ['true'] : [],
            onChange: (values) => setEquipmentLocked(values.length > 0),
            options: [{ value: 'true', label: 'Locked ships' }],
        },
    ];

    const sortOptions = [
        { value: 'id', label: 'Date Added' },
        { value: 'name', label: 'Name' },
        { value: 'type', label: 'Type' },
        { value: 'faction', label: 'Faction' },
        { value: 'rarity', label: 'Rarity' },
        { value: 'gearCount', label: 'Gear' },
        // Add stat-based sort options
        ...ALL_STAT_NAMES.map((stat) => ({
            value: stat,
            label: STATS[stat].label,
        })),
    ];

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
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
                        Showing {visibleItems.length} of {sortedInventory.length} ships
                        {ships.length !== sortedInventory.length && ` (${ships.length} total)`}
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
                    searchPlaceholder="Search ships..."
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                />
            </div>

            {sortedInventory.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                    {ships.length === 0 ? 'No ships created yet' : 'No matching ships found'}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {visibleItems.map((ship) => (
                            <ShipCard
                                key={ship.id}
                                ship={ship}
                                allShips={ships}
                                hoveredGear={hoveredGear}
                                availableGear={availableGear}
                                getGearPiece={getGearPiece}
                                onEdit={onEdit}
                                onRemove={onRemove}
                                onLockEquipment={onLockEquipment}
                                onEquipGear={onEquipGear}
                                onRemoveGear={onRemoveGear}
                                onUnequipAll={onUnequipAll}
                                onHoverGear={setHoveredGear}
                                viewMode={viewMode}
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
