import { useState, useEffect } from 'react';

export interface StatFilter {
    statName: string;
    statType: 'flat' | 'percentage';
}

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
        equipmentLocked?: boolean;
        affinities?: string[];
        // New advanced filters
        levelRange?: {
            min: number;
            max: number;
        };
        statFilters?: StatFilter[];
        mainStatFilters?: StatFilter[];
        subStatFilters?: StatFilter[];
    };
}

const DEFAULT_STATE: FilterState = {
    sort: { field: 'power', direction: 'desc' },
    filters: {
        factions: [],
        shipTypes: [],
        rarities: [],
        sets: [],
        types: [],
        equipped: '',
        equipmentLocked: false,
        affinities: [],
        levelRange: undefined,
        statFilters: [],
        mainStatFilters: [],
        subStatFilters: [],
    },
};

export function usePersistedFilters(key: string, defaultState?: Partial<FilterState>) {
    const mergedDefault = defaultState
        ? {
              ...DEFAULT_STATE,
              ...defaultState,
              filters: { ...DEFAULT_STATE.filters, ...defaultState.filters },
          }
        : DEFAULT_STATE;

    const [state, setState] = useState<FilterState>(() => {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : mergedDefault;
    });

    useEffect(() => {
        localStorage.setItem(key, JSON.stringify(state));
    }, [state, key]);

    const clearFilters = () => {
        setState(mergedDefault);
        localStorage.removeItem(key);
    };

    return { state, setState, clearFilters };
}
