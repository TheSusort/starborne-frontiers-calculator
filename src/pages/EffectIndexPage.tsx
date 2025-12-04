import React, { useMemo, useState } from 'react';
import { BUFFS, Buff } from '../constants/buffs';
import { PageLayout } from '../components/ui';
import { FilterPanel, FilterConfig } from '../components/filters/FilterPanel';
import { SortConfig } from '../components/filters/SortPanel';
import { usePersistedFilters } from '../hooks/usePersistedFilters';
import { Image } from '../components/ui/Image';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';

const getTypeBadgeClasses = (type: Buff['type']) => {
    switch (type) {
        case 'buff':
            return 'bg-green-500/20 text-green-400 border border-green-500/30';
        case 'debuff':
            return 'bg-red-500/20 text-red-400 border border-red-500/30';
        case 'effect':
            return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    }
};

export const EffectIndexPage: React.FC = () => {
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { state, setState, clearFilters } = usePersistedFilters('effect-index-filters');
    const hasActiveFilters = (state.filters.types?.length ?? 0) > 0 || searchQuery.length > 0;

    const setSelectedTypes = (types: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, types },
        }));
    };

    const setSort = (sort: SortConfig) => {
        setState((prev) => ({ ...prev, sort }));
    };

    const sortOptions = [{ value: 'name', label: 'Name' }];

    const filters: FilterConfig[] = [
        {
            id: 'type',
            label: 'Type',
            values: state.filters.types ?? [],
            onChange: setSelectedTypes,
            options: [
                { value: 'buff', label: 'Buff' },
                { value: 'debuff', label: 'Debuff' },
                { value: 'effect', label: 'Effect' },
            ],
        },
    ];

    const filteredAndSortedEffects = useMemo(() => {
        const filtered = BUFFS.filter((buff: Buff) => {
            const matchesType =
                (state.filters.types?.length ?? 0) === 0 ||
                (state.filters.types?.includes(buff.type) ?? false);
            const matchesSearch =
                searchQuery === '' ||
                buff.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                buff.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
                buff.description.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesType && matchesSearch;
        });

        return [...filtered].sort((a: Buff, b: Buff) => {
            return state.sort.direction === 'asc'
                ? a.name.localeCompare(b.name)
                : b.name.localeCompare(a.name);
        });
    }, [state.filters, state.sort, searchQuery]);

    return (
        <>
            <Seo {...SEO_CONFIG.effectIndex} />
            <PageLayout
                title="Effect Index"
                description="Browse all buffs, debuffs, and effects in Starborne Frontiers. Search and filter through game effects."
            >
                <div className="space-y-6">
                    <div className="flex flex-col">
                        {filteredAndSortedEffects.length > 0 && (
                            <span className="text-sm text-gray-400">
                                Showing {filteredAndSortedEffects.length} effects
                            </span>
                        )}

                        <FilterPanel
                            filters={filters}
                            isOpen={isFilterOpen}
                            onToggle={() => setIsFilterOpen(!isFilterOpen)}
                            onClear={() => {
                                clearFilters();
                                setSearchQuery('');
                            }}
                            hasActiveFilters={hasActiveFilters}
                            sortOptions={sortOptions}
                            sort={state.sort}
                            setSort={setSort}
                            searchValue={searchQuery}
                            onSearchChange={setSearchQuery}
                            searchPlaceholder="Search effects by name, type, or description..."
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredAndSortedEffects.length > 0 ? (
                            filteredAndSortedEffects.map((buff: Buff, index: number) => (
                                <div
                                    key={index}
                                    className="card p-4 hover:border-primary transition-colors duration-200"
                                >
                                    <div className="flex flex-col space-y-3">
                                        {/* Type Badge */}
                                        <div className="flex justify-start">
                                            <span
                                                className={`px-3 py-1 text-xs font-semibold uppercase ${getTypeBadgeClasses(buff.type)}`}
                                            >
                                                {buff.type}
                                            </span>
                                        </div>

                                        {/* Optional Image */}
                                        {buff.imageKey && (
                                            <div className="flex justify-center">
                                                <div className="w-12 h-12 flex items-center justify-center">
                                                    <Image
                                                        src={buff.imageKey}
                                                        alt={buff.name}
                                                        className="w-12 h-12"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Effect Name */}
                                        <h3 className="text-lg font-semibold text-white">
                                            {buff.name}
                                        </h3>

                                        {/* Description */}
                                        <p className="text-sm text-gray-300">{buff.description}</p>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="col-span-full text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                                No matching effects found
                            </div>
                        )}
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default EffectIndexPage;
