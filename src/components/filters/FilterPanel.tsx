import React from 'react';
import { Button } from '../ui/Button';
import { FilterIcon } from '../ui/icons/FilterIcon';
import { Offcanvas } from '../layout/Offcanvas';
import { RadioGroup } from '../ui/RadioGroup';

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
}

export const FilterPanel: React.FC<Props> = ({
    filters,
    isOpen,
    onToggle,
    onClear,
    hasActiveFilters
}) => {
    return (
        <>
            <div className="flex flex-col space-y-4">
                <div className="flex justify-between items-center">
                    {hasActiveFilters && (
                        <Button variant="secondary" onClick={onClear}>
                            Clear Filters
                        </Button>
                    )}
                    <Button variant="secondary" className="ml-auto" onClick={onToggle}>
                        <FilterIcon />
                    </Button>
                </div>
            </div>

            <Offcanvas
                isOpen={isOpen}
                onClose={onToggle}
                title="Filters"
            >
                <div className="space-y-4">
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