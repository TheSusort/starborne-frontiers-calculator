import React, { useMemo, useState } from 'react';
import { useImplantsData } from '../hooks/useImplantsData';
import { PageLayout } from '../components/ui';
import { FilterPanel, FilterConfig } from '../components/filters/FilterPanel';
import { SortConfig } from '../components/filters/SortPanel';
import { usePersistedFilters } from '../hooks/usePersistedFilters';
import { SearchInput } from '../components/ui/SearchInput';
import { Loader } from '../components/ui/Loader';
import { Image } from '../components/ui/Image';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { ImplantData, ImplantVariant } from '../constants/implants';
import { StatDisplay } from '../components/stats/StatDisplay';
import { RARITIES, RARITY_ORDER } from '../constants/rarities';
export const ImplantIndexPage: React.FC = () => {
    const { implants, loading, error } = useImplantsData();
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { state, setState, clearFilters } = usePersistedFilters('implant-database-filters');
    const hasActiveFilters = (state.filters.types?.length ?? 0) > 0;

    const setSelectedTypes = (types: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, types },
        }));
    };

    const setSort = (sort: SortConfig) => {
        setState((prev) => ({ ...prev, sort }));
    };

    const sortOptions = [
        { value: 'name', label: 'Name' },
        { value: 'type', label: 'Type' },
    ];

    const filters: FilterConfig[] = [
        {
            id: 'type',
            label: 'Type',
            values: state.filters.types ?? [],
            onChange: setSelectedTypes,
            options: [
                { value: 'major', label: 'Major' },
                { value: 'alpha(minor)', label: 'Alpha (Minor)' },
                { value: 'gamma(minor)', label: 'Gamma (Minor)' },
                { value: 'sigma(minor)', label: 'Sigma (Minor)' },
                { value: 'ultimate', label: 'Ultimate' },
            ],
        },
    ];

    const filteredAndSortedImplants = useMemo(() => {
        if (!implants) return [];

        const filtered = implants.filter((implant: ImplantData) => {
            const matchesType =
                (state.filters.types?.length ?? 0) === 0 ||
                (state.filters.types?.includes(implant.type) ?? false);
            const matchesSearch =
                searchQuery === '' ||
                implant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                implant.variants.some(
                    (variant: ImplantVariant) =>
                        variant.description?.toLowerCase().includes(searchQuery.toLowerCase()) ??
                        false
                );
            return matchesType && matchesSearch;
        });

        return [...filtered].sort((a: ImplantData, b: ImplantData) => {
            switch (state.sort.field) {
                case 'type':
                    return state.sort.direction === 'asc'
                        ? a.type.localeCompare(b.type)
                        : b.type.localeCompare(a.type);
                default:
                    return state.sort.direction === 'asc'
                        ? a.name.localeCompare(b.name)
                        : b.name.localeCompare(a.name);
            }
        });
    }, [implants, state.filters, state.sort, searchQuery]);

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
        <>
            <Seo {...SEO_CONFIG.implantDatabase} />
            <PageLayout
                title="Implant Database"
                description="Browse all available implants and their effects. Stat values shown are examples, actual values varies as they are randomised to an extent."
            >
                <div className="space-y-6">
                    <div className="flex flex-col">
                        <div className="flex-grow max-w-md mb-2">
                            <SearchInput
                                value={searchQuery}
                                onChange={setSearchQuery}
                                placeholder="Search implants by name or description..."
                                className="w-full mb-2"
                            />
                        </div>
                        {filteredAndSortedImplants.length > 0 && (
                            <span className="text-sm text-gray-400">
                                Showing {filteredAndSortedImplants.length} implants
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

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredAndSortedImplants.length > 0 ? (
                            filteredAndSortedImplants.map((implant: ImplantData, index: number) => (
                                <div
                                    key={index}
                                    className="bg-dark p-4 border border-dark-border hover:border-primary transition-colors duration-200"
                                >
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-4 mb-4">
                                            {implant.imageKey && (
                                                <div className="w-24 h-24 flex items-center justify-center">
                                                    <Image
                                                        src={implant.imageKey}
                                                        alt={implant.name}
                                                        className="w-12 h-12"
                                                    />
                                                </div>
                                            )}
                                            <div>
                                                <h3 className="text-xl font-semibold">
                                                    {implant.name}
                                                </h3>
                                                <div className="text-sm text-gray-400 capitalize">
                                                    {implant.type} Implant
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-4">
                                            {implant.variants
                                                .sort(
                                                    (a, b) =>
                                                        RARITY_ORDER.indexOf(a.rarity) -
                                                        RARITY_ORDER.indexOf(b.rarity)
                                                )
                                                .map((variant: ImplantVariant, index: number) => (
                                                    <div
                                                        key={index}
                                                        className={`bg-dark p-4 border ${RARITIES[variant.rarity].borderColor}`}
                                                    >
                                                        {variant.stats &&
                                                            variant.stats.length > 0 && (
                                                                <div className="text-sm mb-2">
                                                                    <StatDisplay
                                                                        stats={variant.stats}
                                                                    />
                                                                </div>
                                                            )}
                                                        <p className="text-sm text-gray-400">
                                                            {variant.description}
                                                        </p>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="col-span-full text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                                No matching implants found
                            </div>
                        )}
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ImplantIndexPage;
