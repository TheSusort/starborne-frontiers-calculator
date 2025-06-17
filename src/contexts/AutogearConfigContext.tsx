import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { SavedAutogearConfig } from '../types/autogear';
import { AutogearAlgorithm } from '../utils/autogear/AutogearStrategy';
import { ShipTypeName } from '../constants';
import { useStorage } from '../hooks/useStorage';
import { StorageKey } from '../constants/storage';
import { useAuth } from './AuthProvider';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';

interface AutogearConfigContextType {
    savedConfigs: Record<string, SavedAutogearConfig>;
    saveConfig: (config: SavedAutogearConfig) => Promise<void>;
    getConfig: (shipId: string) => SavedAutogearConfig | null;
    resetConfig: (shipId: string) => Promise<void>;
    loading: boolean;
}

const AutogearConfigContext = createContext<AutogearConfigContextType | null>(null);

interface RawAutogearConfig {
    user_id: string;
    ship_id: string;
    config: SavedAutogearConfig;
}

const transformConfigs = (data: RawAutogearConfig[]): Record<string, SavedAutogearConfig> => {
    return data.reduce(
        (acc, item) => {
            acc[item.ship_id] = item.config;
            return acc;
        },
        {} as Record<string, SavedAutogearConfig>
    );
};

export const AutogearConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [isMigrating, setIsMigrating] = useState(false);

    const { data: savedConfigs, setData: setSavedConfigs } = useStorage<
        Record<string, SavedAutogearConfig>
    >({
        key: StorageKey.AUTOGEAR_CONFIGS,
        defaultValue: {},
    });

    const loadConfigs = useCallback(async () => {
        // Skip loading if we're in the middle of migration
        if (isMigrating) return;

        try {
            setLoading(true);
            if (user?.id) {
                const { data, error } = await supabase
                    .from('autogear_configs')
                    .select('*')
                    .eq('user_id', user.id);

                if (error) {
                    throw error;
                }

                if (data) {
                    setSavedConfigs(transformConfigs(data));
                }
            }
        } catch (error) {
            console.error('Error loading autogear configs:', error);
            addNotification('error', 'Failed to load autogear configurations');
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification, setSavedConfigs, isMigrating]);

    // Initial load and reload on auth changes
    useEffect(() => {
        loadConfigs();
    }, [user?.id, loadConfigs]);

    // Clear data on sign out
    useEffect(() => {
        const handleSignOut = () => {
            // Only clear data if we're not in the middle of migration
            if (!isMigrating) {
                setSavedConfigs({});
            }
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setSavedConfigs, isMigrating]);

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

    const saveConfig = useCallback(
        async (config: SavedAutogearConfig) => {
            const oldConfigs = { ...savedConfigs }; // Preserve old configs for potential rollback
            setSavedConfigs((prev) => ({
                ...prev,
                [config.shipId]: config,
            })); // Optimistic update

            if (!user?.id) return;

            try {
                const { error } = await supabase.from('autogear_configs').upsert(
                    {
                        user_id: user.id,
                        ship_id: config.shipId,
                        config: config,
                    },
                    {
                        onConflict: 'user_id, ship_id',
                    }
                );

                if (error) throw error;

                addNotification('success', 'Configuration saved successfully');
            } catch (error) {
                setSavedConfigs(oldConfigs); // Revert optimistic update on error
                console.error('Error saving autogear config:', error);
                addNotification('error', 'Failed to save configuration');
                throw error;
            }
        },
        [user?.id, addNotification, savedConfigs, setSavedConfigs]
    );

    const getConfig = useCallback(
        (shipId: string) => {
            return savedConfigs[shipId] || null;
        },
        [savedConfigs]
    );

    const resetConfig = useCallback(
        async (shipId: string) => {
            const oldConfigs = { ...savedConfigs }; // Preserve old configs
            setSavedConfigs((prev) => {
                const newConfigs = { ...prev };
                delete newConfigs[shipId];
                return newConfigs;
            }); // Optimistic update

            if (!user?.id) return;

            try {
                const { error } = await supabase
                    .from('autogear_configs')
                    .delete()
                    .eq('user_id', user.id)
                    .eq('ship_id', shipId);

                if (error) throw error;

                addNotification('success', 'Configuration reset successfully');
            } catch (error) {
                setSavedConfigs(oldConfigs); // Revert optimistic update on error
                console.error('Error resetting autogear config:', error);
                addNotification('error', 'Failed to reset configuration');
                throw error;
            }
        },
        [user?.id, addNotification, savedConfigs, setSavedConfigs]
    );

    const contextValue = {
        savedConfigs,
        saveConfig,
        getConfig,
        resetConfig,
        loading,
    };

    return (
        <AutogearConfigContext.Provider value={contextValue}>
            {children}
        </AutogearConfigContext.Provider>
    );
};

export const useAutogearConfig = () => {
    const context = useContext(AutogearConfigContext);
    if (!context) {
        throw new Error('useAutogearConfig must be used within an AutogearConfigProvider');
    }
    return context;
};
