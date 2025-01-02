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
            <div className="flex gap-2 items-end">
                <Select
                    label="Sort by"
                    value={currentSort.field}
                    onChange={(value) => {
                        onSort({
                            field: value,
                            direction: 'asc',
                        });
                    }}
                    options={options}
                    className="text-xs"
                />
                <Button
                    aria-label="Toggle sort direction"
                    variant="secondary"
                    className="w-12"
                    onClick={() => {
                        onSort({
                            field: currentSort.field,
                            direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
                        });
                    }}
                >
                    {currentSort.direction === 'asc' ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </Button>
            </div>
        </>
    );
};
