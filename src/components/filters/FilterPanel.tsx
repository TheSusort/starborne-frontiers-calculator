import React from 'react';
import { Button } from '../ui/Button';
import { FilterIcon } from '../ui/icons/FilterIcon';
import { Offcanvas } from '../layout/Offcanvas';
import { RadioGroup } from '../ui/RadioGroup';
import { CloseIcon } from '../ui/icons/CloseIcon';
import { SortConfig, SortOption, SortPanel } from './SortPanel';

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

interface Props {
    filters: FilterConfig[];
    isOpen: boolean;
    onToggle: () => void;
    onClear: () => void;
    hasActiveFilters: boolean;
    sortOptions?: SortOption[];
    sort?: SortConfig;
    setSort?: (sort: SortConfig) => void;
}

export const FilterPanel: React.FC<Props> = ({
    filters,
    isOpen,
    onToggle,
    onClear,
    hasActiveFilters,
    sortOptions,
    sort,
    setSort
}) => {
    return (
        <>
            <div className="flex justify-between items-center">
                {hasActiveFilters && (
                    <>
                        {/* list out all the active filters, add a close button to each */}
                        <div className="flex flex-wrap gap-2">
                            {filters.map((filter) => (
                                filter.values.map((value) => (
                                    <div key={value} className="flex justify-between items-center">
                                        <Button
                                            className="relative flex items-center"
                                            variant="secondary"
                                            onClick={() => filter.onChange([...filter.values.filter(v => v !== value)])}
                                        >
                                            <div className="flex items-center">
                                                <div className="flex flex-col items-start mr-3">
                                                    <span className="text-xxs">{filter.label}</span>
                                                    <span className="text-xs">{filter.options.find(option => option.value === value)?.label}</span>
                                                </div>
                                                <CloseIcon />
                                            </div>
                                        </Button>
                                    </div>
                                ))
                            ))}
                        </div>
                    </>
                )}
                <Button variant="secondary" className="ml-auto" onClick={onToggle}>
                    <FilterIcon />
                </Button>
            </div>

            <Offcanvas
                isOpen={isOpen}
                onClose={onToggle}
                title="Filters"
            >
                <div className="space-y-4">
                    {sortOptions && sort && setSort && (
                        <SortPanel
                            options={sortOptions}
                            currentSort={sort}
                            onSort={setSort}
                        />
                    )}

                    {filters.map((filter) => (
                        <RadioGroup
                            key={filter.id}
                            label={filter.label}
                            values={filter.values}
                            onChange={filter.onChange}
                            options={filter.options}
                        />
                    ))}

                    {hasActiveFilters && (
                        <div className="pt-4">
                            <Button
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