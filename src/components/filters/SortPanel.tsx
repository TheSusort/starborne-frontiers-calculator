import React from 'react';
import { Button, Select, ChevronUpIcon, ChevronDownIcon } from '../ui';

export type SortOption = {
    value: string;
    label: string;
};

export type SortConfig = {
    field: string;
    direction: 'asc' | 'desc';
};

interface Props {
    options: SortOption[];
    currentSort: SortConfig;
    onSort: (sort: SortConfig) => void;
}

export const SortPanel: React.FC<Props> = ({ options, currentSort, onSort }) => {
    return (
        <>
            <span className="block text-sm font-medium text-gray-300 mb-2">
                Sorting
            </span>
            <div className="flex gap-2 items-center">
                <Select
                    value={currentSort.field}
                    onChange={(e) => {
                        onSort({
                            field: e.target.value,
                            direction: 'asc'
                        });
                    }}
                    options={options}
                    noDefaultSelection={false}
                    className="text-xs"
                />
                <Button
                    variant="secondary"
                    className="w-12"
                    onClick={() => {
                        onSort({
                            field: currentSort.field,
                            direction: currentSort.direction === 'asc' ? 'desc' : 'asc'
                        });
                    }}
                >
                    {currentSort.direction === 'asc' ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </Button>
            </div>
        </>
    );
};