import React, {
    ReactNode,
    useCallback,
    useState,
    useEffect,
    createContext,
    useContext,
} from 'react';
import { EngineeringStats, EngineeringStat, StatName, StatType, Stat } from '../types/stats';
import { STATS } from '../constants/stats';
import { ShipTypeName } from '../constants/shipTypes';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthProvider';
import { useStorage } from '../hooks/useStorage';
import { StorageKey } from '../constants/storage';

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
                    shipType: stat.ship_type as ShipTypeName, // Added type assertion
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

interface EngineeringStatsProviderProps {
    children: ReactNode;
}

export const EngineeringStatsProvider: React.FC<EngineeringStatsProviderProps> = ({ children }) => {
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);

    const { data: engineeringStats, setData: setEngineeringStats } = useStorage<EngineeringStats>({
        key: StorageKey.ENGINEERING_STATS,
        defaultValue: { stats: [] },
    });

    const loadEngineeringStats = useCallback(async () => {
        try {
            setLoading(true);
            if (user?.id) {
                const { data, error } = await supabase
                    .from('engineering_stats')
                    .select('*')
                    .eq('user_id', user.id);

                if (error) throw error;
                setEngineeringStats(transformEngineeringStats(data));
            }
        } catch (error) {
            console.error('Error loading engineering stats:', error);
            addNotification('error', 'Failed to load engineering stats');
        } finally {
            setLoading(false);
        }
    }, [user?.id, setLoading, setEngineeringStats, addNotification]);

    useEffect(() => {
        loadEngineeringStats();
    }, [user?.id, loadEngineeringStats]);

    useEffect(() => {
        const handleSignOut = () => {
            setEngineeringStats({ stats: [] });
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setEngineeringStats]);

    const saveEngineeringStats = useCallback(
        async (statsToSave: EngineeringStats) => {
            const oldStats = { ...engineeringStats }; // Preserve old stats for potential rollback
            setEngineeringStats(statsToSave); // Optimistic update

            if (!user?.id) return;

            try {
                const shipTypes = statsToSave.stats.map((stat) => stat.shipType);
                if (shipTypes.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('engineering_stats')
                        .delete()
                        .eq('user_id', user.id)
                        .in('ship_type', shipTypes);
                    if (deleteError) throw deleteError;
                }

                const records = statsToSave.stats.flatMap((stat) =>
                    stat.stats.map((s) => ({
                        user_id: user.id,
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
                setEngineeringStats(oldStats); // Revert optimistic update on error
                console.error('Error saving engineering stats:', error);
                addNotification('error', 'Failed to save engineering stats');
                throw error;
            }
        },
        [user?.id, addNotification, engineeringStats, setEngineeringStats] // Simplified deps, loadEngineeringStats removed as it would cause re-fetch
    );

    const deleteEngineeringStats = useCallback(
        async (shipTypeToDelete: string) => {
            const oldStats = { ...engineeringStats }; // Preserve old stats
            setEngineeringStats((prev) => ({
                stats: prev.stats.filter((stat) => stat.shipType !== shipTypeToDelete),
            })); // Optimistic update

            if (!user?.id) return;

            try {
                const { error } = await supabase
                    .from('engineering_stats')
                    .delete()
                    .eq('user_id', user.id)
                    .eq('ship_type', shipTypeToDelete);

                if (error) throw error;

                addNotification('success', 'Engineering stats deleted successfully');
            } catch (error) {
                setEngineeringStats(oldStats); // Revert optimistic update on error
                console.error('Error deleting engineering stats:', error);
                addNotification('error', 'Failed to delete engineering stats');
                throw error;
            }
        },
        [user?.id, addNotification, engineeringStats, setEngineeringStats] // Simplified deps
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
