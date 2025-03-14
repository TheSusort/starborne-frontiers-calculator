import { useCallback } from 'react';
import { EngineeringStats, StatName, StatType } from '../types/stats';
import { STATS } from '../constants/stats';
import { ShipTypeName } from '../constants/shipTypes';
import { useStorage } from './useStorage';
import { STORAGE_KEYS } from '../constants/storage';

const STORAGE_KEY = STORAGE_KEYS.ENGINEERING_STATS;

export const useEngineeringStats = () => {
    const {
        data: engineeringStats = { stats: [] },
        setData: setEngineeringStats,
        loading,
    } = useStorage<EngineeringStats>({
        key: STORAGE_KEY,
        defaultValue: { stats: [] },
        useRealtime: false, // Metadata doesn't need real-time updates
    });

    const saveEngineeringStats = useCallback(
        (stats: EngineeringStats) => {
            setEngineeringStats(stats);
        },
        [setEngineeringStats]
    );

    const deleteEngineeringStats = useCallback(
        (shipType: string) => {
            setEngineeringStats({
                stats: engineeringStats.stats.filter((stat) => stat.shipType !== shipType),
            });
        },
        [engineeringStats, setEngineeringStats]
    );

    // Returns all allowed stats and their types for engineering
    const getAllAllowedStats = useCallback(() => {
        const statsEntries = Object.entries(STATS)
            .filter(([_, value]) => value.engineeringAllowedTypes)
            .map(([key, value]) => [key, { allowedTypes: value.engineeringAllowedTypes }]);

        return Object.fromEntries(statsEntries) as Record<
            StatName,
            { allowedTypes: StatType[] | undefined }
        >;
    }, []);

    const getEngineeringStatsForShipType = useCallback(
        (shipType: ShipTypeName) => {
            // if SUPPORTER_BUFFER, use SUPPORTER stats
            if (shipType === 'SUPPORTER_BUFFER') {
                return engineeringStats.stats.find((stat) => stat.shipType === 'SUPPORTER');
            }
            return engineeringStats.stats.find((stat) => stat.shipType === shipType);
        },
        [engineeringStats]
    );

    return {
        engineeringStats,
        saveEngineeringStats,
        deleteEngineeringStats,
        getAllAllowedStats,
        getEngineeringStatsForShipType,
        loading,
    };
};
