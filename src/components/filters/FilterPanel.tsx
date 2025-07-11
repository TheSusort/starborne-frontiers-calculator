import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon, CheckboxGroup, Offcanvas, FilterIcon, Button, Input } from '../ui';
import { SortConfig, SortOption, SortPanel } from './SortPanel';
import { SearchIcon } from '../ui/icons/SearchIcon';
import { ListIcon } from '../ui/icons/ListIcon';
import { ImageIcon } from '../ui/icons/ImageIcon';
import { useAuth } from '../../contexts/AuthProvider';
import { RangeFilter } from './RangeFilter';
import { StatFilter } from './StatFilter';
import { StatFilter as StatFilterType } from '../../hooks/usePersistedFilters';
import { STATS } from '../../constants/stats';
import { StatName } from '../../types/stats';

export interface FilterOption {
    label: string;
    value: string;
}

export interface FilterConfig {
    id: string;
    label: string;
    options: FilterOption[];
    values: string[];
    onChange: (values: string[]) => void;
}

export interface RangeFilterConfig {
    id: string;
    label: string;
    minValue: number;
    maxValue: number;
    onMinChange: (value: number) => void;
    onMaxChange: (value: number) => void;
    onClear?: () => void;
    minPlaceholder?: string;
    maxPlaceholder?: string;
}

export interface StatFilterConfig {
    id: string;
    label: string;
    statFilters: StatFilterType[];
    onStatFiltersChange: (filters: StatFilterType[]) => void;
}

interface Props {
    filters: FilterConfig[];
    rangeFilters?: RangeFilterConfig[];
    statFilters?: StatFilterConfig[];
    isOpen: boolean;
    onToggle: () => void;
    onClear: () => void;
    hasActiveFilters: boolean;
    sortOptions?: SortOption[];
    sort?: SortConfig;
    setSort?: (sort: SortConfig) => void;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
    searchPlaceholder?: string;
    viewMode?: 'list' | 'image';
    onViewModeChange?: (mode: 'list' | 'image') => void;
}

export const FilterPanel: React.FC<Props> = ({
    filters,
    rangeFilters = [],
    statFilters = [],
    isOpen,
    onToggle,
    onClear,
    hasActiveFilters,
    sortOptions,
    sort,
    setSort,
    searchValue,
    onSearchChange,
    searchPlaceholder = 'Search...',
    viewMode = 'list',
    onViewModeChange,
}) => {
    const { user } = useAuth();
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isSearchExpanded && searchInputRef.current) {
            // Small delay to ensure the input is visible
            setTimeout(() => {
                searchInputRef.current?.focus();
            }, 50);
        }
    }, [isSearchExpanded]);

    const handleSearchToggle = () => {
        setIsSearchExpanded(!isSearchExpanded);

        // Clear search value when search is closed
        if (isSearchExpanded && onSearchChange) {
            onSearchChange('');
        }
    };

    return (
        <>
            <div className="flex justify-between items-center flex-wrap -mt-8">
                {hasActiveFilters && (
                    <div className="flex flex-wrap gap-2 me-2 order-2 md:order-unset w-full pt-2">
                        {filters.map((filter) =>
                            filter.values.map((value) => (
                                <div key={value} className="flex justify-between items-center">
                                    <Button
                                        aria-label={`Remove ${filter.label} filter`}
                                        className="relative flex items-center"
                                        variant="secondary"
                                        onClick={() =>
                                            filter.onChange([
                                                ...filter.values.filter((v) => v !== value),
                                            ])
                                        }
                                    >
                                        <div className="flex items-center">
                                            <div className="flex flex-col items-start mr-3">
                                                <span className="text-xxs">{filter.label}</span>
                                                <span className="text-xs">
                                                    {
                                                        filter.options.find(
                                                            (option) => option.value === value
                                                        )?.label
                                                    }
                                                </span>
                                            </div>
                                            <CloseIcon />
                                        </div>
                                    </Button>
                                </div>
                            ))
                        )}
                        {rangeFilters.map((filter) => {
                            if (filter.minValue > 0 || filter.maxValue > 0) {
                                return (
                                    <div
                                        key={filter.id}
                                        className="flex justify-between items-center"
                                    >
                                        <Button
                                            aria-label={`Remove ${filter.label} filter`}
                                            className="relative flex items-center"
                                            variant="secondary"
                                            onClick={() => {
                                                if (filter.onClear) {
                                                    filter.onClear();
                                                } else {
                                                    filter.onMinChange(0);
                                                    filter.onMaxChange(0);
                                                }
                                            }}
                                        >
                                            <div className="flex items-center">
                                                <div className="flex flex-col items-start mr-3">
                                                    <span className="text-xxs">{filter.label}</span>
                                                    <span className="text-xs">
                                                        {filter.minValue > 0 && filter.maxValue > 0
                                                            ? `${filter.minValue}-${filter.maxValue}`
                                                            : filter.minValue > 0
                                                              ? `≥${filter.minValue}`
                                                              : `≤${filter.maxValue}`}
                                                    </span>
                                                </div>
                                                <CloseIcon />
                                            </div>
                                        </Button>
                                    </div>
                                );
                            }
                            return null;
                        })}
                        {statFilters.map((filter) =>
                            filter.statFilters.map((statFilter, index) => (
                                <div
                                    key={`${filter.id}-${index}`}
                                    className="flex justify-between items-center"
                                >
                                    <Button
                                        aria-label={`Remove ${statFilter.statName} filter`}
                                        className="relative flex items-center"
                                        variant="secondary"
                                        onClick={() => {
                                            const newFilters = filter.statFilters.filter(
                                                (_, i) => i !== index
                                            );
                                            filter.onStatFiltersChange(newFilters);
                                        }}
                                    >
                                        <div className="flex items-center">
                                            <div className="flex flex-col items-start mr-3">
                                                <span className="text-xxs">Stat</span>
                                                <span className="text-xs">
                                                    {
                                                        STATS[statFilter.statName as StatName]
                                                            .shortLabel
                                                    }
                                                    {statFilter.statType === 'percentage'
                                                        ? '%'
                                                        : ''}
                                                </span>
                                            </div>
                                            <CloseIcon />
                                        </div>
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                )}
                <div className="flex gap-2 ml-auto">
                    {onViewModeChange && user && (
                        <div className="flex">
                            {viewMode === 'image' && (
                                <Button
                                    variant="secondary"
                                    onClick={() => onViewModeChange('list')}
                                    aria-label="List view"
                                    title="List view"
                                >
                                    <ListIcon />
                                </Button>
                            )}
                            {viewMode === 'list' && (
                                <Button
                                    variant="secondary"
                                    onClick={() => onViewModeChange('image')}
                                    aria-label="Image view"
                                    title="Image view"
                                >
                                    <ImageIcon />
                                </Button>
                            )}
                        </div>
                    )}
                    {onSearchChange && (
                        <div className="relative min-w-[50px]">
                            <div
                                className={`flex items-center transition-all duration-300 ease-in-out ${isSearchExpanded ? 'w-64' : 'w-0'}`}
                            >
                                <Input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchValue}
                                    onChange={(e) => onSearchChange(e.target.value)}
                                    placeholder={searchPlaceholder}
                                    className={`w-full !pr-12 transition-opacity duration-300 ${isSearchExpanded ? 'opacity-100' : 'opacity-0'}`}
                                />
                                <Button
                                    variant="secondary"
                                    onClick={handleSearchToggle}
                                    className={`!absolute right-0 top-0 transition-opacity duration-300 ${isSearchExpanded ? 'opacity-100' : 'opacity-0'}`}
                                >
                                    <CloseIcon />
                                </Button>
                            </div>
                            <Button
                                variant="secondary"
                                onClick={handleSearchToggle}
                                aria-label="Search"
                                title="Search"
                                className={`!absolute right-0 top-0 transition-opacity duration-300 ${isSearchExpanded ? 'opacity-0' : 'opacity-100'}`}
                            >
                                <SearchIcon />
                            </Button>
                        </div>
                    )}
                    <Button
                        variant="secondary"
                        onClick={onToggle}
                        aria-label="Filters and sorting"
                        title="Filters and sorting"
                    >
                        <FilterIcon />
                    </Button>
                </div>
            </div>

            <Offcanvas isOpen={isOpen} onClose={onToggle} title="Filters">
                <div className="space-y-4 pb-6">
                    {sortOptions && sort && setSort && (
                        <SortPanel options={sortOptions} currentSort={sort} onSort={setSort} />
                    )}

                    {filters.map((filter) => (
                        <CheckboxGroup
                            key={filter.id}
                            label={filter.label}
                            values={filter.values}
                            onChange={filter.onChange}
                            options={filter.options}
                        />
                    ))}

                    {rangeFilters.map((filter) => (
                        <RangeFilter
                            key={filter.id}
                            label={filter.label}
                            minValue={filter.minValue}
                            maxValue={filter.maxValue}
                            onMinChange={filter.onMinChange}
                            onMaxChange={filter.onMaxChange}
                            minPlaceholder={filter.minPlaceholder}
                            maxPlaceholder={filter.maxPlaceholder}
                        />
                    ))}

                    {statFilters.map((filter) => (
                        <StatFilter
                            key={filter.id}
                            statFilters={filter.statFilters}
                            onStatFiltersChange={filter.onStatFiltersChange}
                        />
                    ))}

                    {hasActiveFilters && (
                        <div className="pt-4">
                            <Button
                                aria-label="Clear filters"
                                variant="secondary"
                                fullWidth
                                onClick={onClear}
                            >
                                Clear Filters
                            </Button>
                        </div>
                    )}
                </div>
            </Offcanvas>
        </>
    );
};
