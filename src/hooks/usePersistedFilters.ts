import { useState, useEffect } from 'react';

export interface FilterState {
    sort: {
        field: string;
        direction: 'asc' | 'desc';
    };
    filters: {
        factions?: string[];
        shipTypes?: string[];
        rarities: string[];
        sets?: string[];
        types?: string[];
        equipped?: string;
    };
}

const DEFAULT_STATE: FilterState = {
    sort: { field: 'name', direction: 'asc' },
    filters: {
        factions: [],
        shipTypes: [],
        rarities: [],
        sets: [],
        types: [],
        equipped: '',
    },
};

export function usePersistedFilters(key: string) {
    const [state, setState] = useState<FilterState>(() => {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : DEFAULT_STATE;
    });

    useEffect(() => {
        localStorage.setItem(key, JSON.stringify(state));
    }, [state, key]);

    const clearFilters = () => {
        setState(DEFAULT_STATE);
        localStorage.removeItem(key);
    };

    return { state, setState, clearFilters };
}
