import { useState, useCallback, useEffect } from 'react';
import { EngineeringStats, StatName, StatType } from '../types/stats';
import { STATS } from '../constants/stats';

const STORAGE_KEY = 'engineeringStats';

const getInitialStats = (): EngineeringStats => {
    const savedStats = localStorage.getItem(STORAGE_KEY);
    if (savedStats) {
        try {
            return JSON.parse(savedStats);
        } catch (error) {
            console.error('Failed to parse engineering stats:', error);
        }
    }
    return { stats: [] };
};

export const useEngineeringStats = () => {
    const [engineeringStats, setEngineeringStats] = useState<EngineeringStats>(getInitialStats());

    // Save to localStorage whenever stats change
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(engineeringStats));
    }, [engineeringStats]);

    const saveEngineeringStats = useCallback((stats: EngineeringStats) => {
        setEngineeringStats(stats);
    }, []);

    const deleteEngineeringStats = useCallback((shipType: string) => {
        setEngineeringStats(current => ({
            stats: current.stats.filter(stat => stat.shipType !== shipType)
        }));
    }, []);

    // Returns all allowed stats and their types for engineering
    const getAllAllowedStats = () => {
        const statsEntries = Object.entries(STATS)
            .filter(([_, value]) => value.engineeringAllowedTypes) // Only include stats with allowed types
            .map(([key, value]) => [
                key,
                { allowedTypes: value.engineeringAllowedTypes }
            ]);

        return Object.fromEntries(statsEntries) as Record<StatName, { allowedTypes: StatType[] | undefined }>;
    };

    return {
        engineeringStats,
        saveEngineeringStats,
        deleteEngineeringStats,
        getAllAllowedStats
    };
};