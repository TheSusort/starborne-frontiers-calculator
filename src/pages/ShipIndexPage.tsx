import React, { useMemo, useState } from 'react';
import { useShipsData } from '../hooks/useShipsData';
import { PageLayout } from '../components/ui';
import { ShipDisplay } from '../components/ship/ShipDisplay';
import { Image } from '../components/ui/Image';
import { Loader } from '../components/ui/Loader';
import { FilterPanel, FilterConfig } from '../components/filters/FilterPanel';
import { SortConfig } from '../components/filters/SortPanel';
import { usePersistedFilters } from '../hooks/usePersistedFilters';
import { SHIP_TYPES, FACTIONS, RARITY_ORDER, RARITIES } from '../constants';
import { SearchInput } from '../components/ui/SearchInput';

export const ShipIndexPage: React.FC = () => {
    const { ships, loading, error } = useShipsData();
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { state, setState, clearFilters } = usePersistedFilters('ship-database-filters');
    const hasActiveFilters =
        (state.filters.factions?.length ?? 0) > 0 ||
        (state.filters.shipTypes?.length ?? 0) > 0 ||
        (state.filters.rarities?.length ?? 0) > 0;

    const setSelectedFactions = (factions: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, factions },
        }));
    };

    const setSelectedShipTypes = (shipTypes: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, shipTypes },
        }));
    };

    const setSelectedRarities = (rarities: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, rarities },
        }));
    };

    const setSort = (sort: SortConfig) => {
        setState((prev) => ({ ...prev, sort }));
    };

    const sortOptions = [
        { value: 'name', label: 'Name' },
        { value: 'type', label: 'Type' },
        { value: 'faction', label: 'Faction' },
        { value: 'rarity', label: 'Rarity' },
    ];

    const filters: FilterConfig[] = [
        {
            id: 'faction',
            label: 'Factions',
            values: state.filters.factions ?? [],
            onChange: setSelectedFactions,
            options: Object.entries(FACTIONS).map(([key, faction]) => ({
                value: key,
                label: faction.name,
            })),
        },
        {
            id: 'shipType',
            label: 'Ship Type',
            values: state.filters.shipTypes ?? [],
            onChange: setSelectedShipTypes,
            options: Object.entries(SHIP_TYPES).map(([key, type]) => ({
                value: key,
                label: type.name,
            })),
        },
        {
            id: 'rarity',
            label: 'Rarity',
            values: state.filters.rarities ?? [],
            onChange: setSelectedRarities,
            options: Object.entries(RARITIES).map(([key, rarity]) => ({
                value: key,
                label: rarity.label,
            })),
        },
    ];

    const filteredAndSortedShips = useMemo(() => {
        if (!ships) return [];

        const filtered = ships.filter((ship) => {
            const matchesFaction =
                (state.filters.factions?.length ?? 0) === 0 ||
                (state.filters.factions?.includes(ship.faction) ?? false);
            const matchesType =
                (state.filters.shipTypes?.length ?? 0) === 0 ||
                (state.filters.shipTypes?.includes(ship.type) ?? false);
            const matchesRarity =
                (state.filters.rarities?.length ?? 0) === 0 ||
                (state.filters.rarities?.includes(ship.rarity) ?? false);
            const matchesSearch =
                searchQuery === '' || ship.name.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesFaction && matchesType && matchesRarity && matchesSearch;
        });

        return [...filtered].sort((a, b) => {
            switch (state.sort.field) {
                case 'type':
                    return state.sort.direction === 'asc'
                        ? SHIP_TYPES[a.type].name.localeCompare(SHIP_TYPES[b.type].name)
                        : SHIP_TYPES[b.type].name.localeCompare(SHIP_TYPES[a.type].name);
                case 'faction':
                    return state.sort.direction === 'asc'
                        ? FACTIONS[a.faction].name.localeCompare(FACTIONS[b.faction].name)
                        : FACTIONS[b.faction].name.localeCompare(FACTIONS[a.faction].name);
                case 'rarity':
                    return state.sort.direction === 'asc'
                        ? RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
                        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                default:
                    return state.sort.direction === 'asc'
                        ? a.name.localeCompare(b.name)
                        : b.name.localeCompare(a.name);
            }
        });
    }, [ships, state.filters, state.sort, searchQuery]);

    if (loading) {
        return <Loader />;
    }

    if (error) {
        return (
            <div className="text-center text-red-500">
                <p>Error: {error}</p>
            </div>
        );
    }

    return (
        <PageLayout
            title="Ship Database"
            description="Browse all ships I've bothered to add and their base statistics at level 60, no refits."
        >
            <div className="space-y-6">
                <div className="flex flex-col">
                    <div className="flex-grow max-w-md mb-2">
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Search ships..."
                            className="w-full"
                        />
                    </div>
                    {filteredAndSortedShips.length > 0 && (
                        <span className="text-sm text-gray-400">
                            Showing {filteredAndSortedShips.length} ships
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
                        setSort={setSort}
                    />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredAndSortedShips.length > 0 ? (
                        filteredAndSortedShips.map((ship) => (
                            <ShipDisplay key={ship.name} ship={ship}>
                                <div className="flex flex-col items-center justify-center border-b border-gray-700 pb-2 m-3">
                                    {ship.imageKey && <Image src={ship.imageKey} alt={ship.name} />}
                                </div>
                            </ShipDisplay>
                        ))
                    ) : (
                        <div className="col-span-full text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                            No matching ships found
                        </div>
                    )}
                </div>
            </div>
        </PageLayout>
    );
};

export default ShipIndexPage;
