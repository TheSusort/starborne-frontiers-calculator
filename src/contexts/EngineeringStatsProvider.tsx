import React, { useCallback, useState, useEffect, createContext, useContext } from 'react';
import { EngineeringStats, EngineeringStat, StatName, StatType, Stat } from '../types/stats';
import { STATS } from '../constants/stats';
import { ShipTypeName } from '../constants/shipTypes';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';
import { useStorage } from '../hooks/useStorage';
import { StorageKey } from '../constants/storage';
import { useActiveProfile, PROFILE_SWITCH_EVENT } from './ActiveProfileProvider';

// -- Start of merged context definition --
export interface EngineeringStatsContextType {
    engineeringStats: EngineeringStats;
    saveEngineeringStats: (stats: EngineeringStats) => Promise<void>;
    deleteEngineeringStats: (shipType: string) => Promise<void>;
    getAllAllowedStats: () => Record<StatName, { allowedTypes: StatType[] | undefined }>;
    getEngineeringStatsForShipType: (
        shipType: ShipTypeName
    ) => EngineeringStats['stats'][0] | undefined;
    loading: boolean;
    setData: (
        data: EngineeringStats | ((prev: EngineeringStats) => EngineeringStats)
    ) => Promise<void>;
}

export const EngineeringStatsContext = createContext<EngineeringStatsContextType | undefined>(
    undefined
);

interface RawEngineeringStat {
    user_id: string;
    ship_type: string;
    stat_name: StatName;
    value: number;
    type: StatType;
}

const transformEngineeringStats = (data: RawEngineeringStat[]): EngineeringStats => {
    const statsByShipType = data.reduce(
        (acc, stat) => {
            if (!acc[stat.ship_type]) {
                acc[stat.ship_type] = {
                    shipType: stat.ship_type, // Added type assertion
                    stats: [],
                };
            }
            acc[stat.ship_type].stats.push({
                name: stat.stat_name,
                value: stat.value,
                type: stat.type,
            } as Stat);
            return acc;
        },
        {} as Record<string, EngineeringStat>
    );

    return {
        stats: Object.values(statsByShipType),
    };
};

export const EngineeringStatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { addNotification } = useNotification();
    const { activeProfileId, profilesLoading } = useActiveProfile();
    const [loading, setLoading] = useState(false);
    const [isMigrating, setIsMigrating] = useState(false);

    // One-time wipe of the legacy unkeyed engineering_stats localStorage entry,
    // so switching profiles doesn't show another profile's cached engineering.
    useEffect(() => {
        const MIGRATION_FLAG = 'engineering_stats_cache_v2_migrated';
        if (!localStorage.getItem(MIGRATION_FLAG)) {
            localStorage.removeItem(StorageKey.ENGINEERING_STATS);
            localStorage.setItem(MIGRATION_FLAG, 'true');
        }
    }, []);

    // Profile-scoped key; fall back to legacy bare key for unauth/demo.
    const engineeringCacheKey = activeProfileId
        ? `${StorageKey.ENGINEERING_STATS}:${activeProfileId}`
        : StorageKey.ENGINEERING_STATS;

    // Use useStorage for engineering stats
    const { data: engineeringStats, setData: setEngineeringStats } = useStorage<EngineeringStats>({
        key: engineeringCacheKey,
        defaultValue: { stats: [] },
    });

    const loadEngineeringStats = useCallback(async () => {
        // Skip loading if we're in the middle of migration
        if (isMigrating) return;

        try {
            setLoading(true);
            if (activeProfileId) {
                const { data, error } = await supabase
                    .from('engineering_stats')
                    .select('*')
                    .eq('user_id', activeProfileId);

                if (error) {
                    throw error;
                }

                if (data) {
                    void setEngineeringStats(
                        transformEngineeringStats(data as RawEngineeringStat[])
                    );
                }
            }
        } catch (error) {
            console.error('Error loading engineering stats:', error);
            addNotification('error', 'Failed to load engineering stats');
        } finally {
            setLoading(false);
        }
    }, [activeProfileId, addNotification, setEngineeringStats, isMigrating]);

    // Initial load and reload on auth/profile changes
    useEffect(() => {
        if (activeProfileId !== null && !profilesLoading) {
            void loadEngineeringStats();
        }
    }, [activeProfileId, profilesLoading, loadEngineeringStats]);

    useEffect(() => {
        const handleSignOut = () => {
            // Only clear data if we're not in the middle of migration
            if (!isMigrating) {
                void setEngineeringStats({
                    stats: [],
                });
            }
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setEngineeringStats, isMigrating]);

    // Reset state when the active profile changes so stale data from the
    // previous profile is cleared before the new profile's data loads.
    useEffect(() => {
        const onSwitch = () => {
            void setEngineeringStats({ stats: [] });
        };
        window.addEventListener(PROFILE_SWITCH_EVENT, onSwitch);
        return () => window.removeEventListener(PROFILE_SWITCH_EVENT, onSwitch);
    }, [setEngineeringStats]);

    // Listen for migration start/end events
    useEffect(() => {
        const handleMigrationStart = () => {
            setIsMigrating(true);
        };

        const handleMigrationEnd = () => {
            setIsMigrating(false);
        };

        window.addEventListener('app:migration:start', handleMigrationStart);
        window.addEventListener('app:migration:end', handleMigrationEnd);

        return () => {
            window.removeEventListener('app:migration:start', handleMigrationStart);
            window.removeEventListener('app:migration:end', handleMigrationEnd);
        };
    }, []);

    const saveEngineeringStats = useCallback(
        async (statsToSave: EngineeringStats) => {
            const oldStats = { ...engineeringStats }; // Preserve old stats for potential rollback
            void setEngineeringStats(statsToSave); // Optimistic update

            if (!activeProfileId) return;

            try {
                const shipTypes = statsToSave.stats.map((stat) => stat.shipType);
                if (shipTypes.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('engineering_stats')
                        .delete()
                        .eq('user_id', activeProfileId)
                        .in('ship_type', shipTypes);
                    if (deleteError) throw deleteError;
                }

                const records = statsToSave.stats.flatMap((stat) =>
                    stat.stats.map((s) => ({
                        user_id: activeProfileId,
                        ship_type: stat.shipType,
                        stat_name: s.name,
                        value: s.value,
                        type: s.type,
                    }))
                );

                if (records.length > 0) {
                    const { error: insertError } = await supabase
                        .from('engineering_stats')
                        .insert(records);
                    if (insertError) throw insertError;
                }

                addNotification('success', 'Engineering stats saved successfully');
            } catch (error) {
                void setEngineeringStats(oldStats); // Revert optimistic update on error
                console.error('Error saving engineering stats:', error);
                addNotification('error', 'Failed to save engineering stats');
                throw error;
            }
        },
        [activeProfileId, addNotification, engineeringStats, setEngineeringStats] // Simplified deps, loadEngineeringStats removed as it would cause re-fetch
    );

    const deleteEngineeringStats = useCallback(
        async (shipTypeToDelete: string) => {
            const oldStats = { ...engineeringStats }; // Preserve old stats
            void setEngineeringStats((prev) => ({
                stats: prev.stats.filter((stat) => stat.shipType !== shipTypeToDelete),
            })); // Optimistic update

            if (!activeProfileId) return;

            try {
                const { error } = await supabase
                    .from('engineering_stats')
                    .delete()
                    .eq('user_id', activeProfileId)
                    .eq('ship_type', shipTypeToDelete);

                if (error) throw error;

                addNotification('success', 'Engineering stats deleted successfully');
            } catch (error) {
                void setEngineeringStats(oldStats); // Revert optimistic update on error
                console.error('Error deleting engineering stats:', error);
                addNotification('error', 'Failed to delete engineering stats');
                throw error;
            }
        },
        [activeProfileId, addNotification, engineeringStats, setEngineeringStats] // Simplified deps
    );

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
        (shipType: ShipTypeName): EngineeringStats['stats'][0] | undefined => {
            if (shipType === 'SUPPORTER_BUFFER') {
                return engineeringStats.stats.find((stat) => stat.shipType === 'SUPPORTER');
            }
            return engineeringStats.stats.find((stat) => stat.shipType === shipType);
        },
        [engineeringStats]
    );

    const contextValue: EngineeringStatsContextType = {
        engineeringStats,
        saveEngineeringStats,
        deleteEngineeringStats,
        getAllAllowedStats,
        getEngineeringStatsForShipType,
        loading,
        setData: setEngineeringStats,
    };

    return (
        <EngineeringStatsContext.Provider value={contextValue}>
            {children}
        </EngineeringStatsContext.Provider>
    );
};

export const useEngineeringStats = () => {
    const context = useContext(EngineeringStatsContext);
    if (context === undefined) {
        throw new Error('useEngineeringStats must be used within an EngineeringStatsProvider');
    }
    return context;
};
