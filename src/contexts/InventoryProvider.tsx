import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { GearPiece } from '../types/gear';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthProvider';
import { Stat, StatName, StatType, FlexibleStats } from '../types/stats';
import { GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { GearSetName } from '../constants/gearSets';
import { useStorage } from '../hooks/useStorage';
import { StorageKey } from '../constants/storage';

interface InventoryContextType {
    inventory: GearPiece[];
    loading: boolean;
    loadingProgress: number;
    getGearPiece: (id: string) => GearPiece | undefined;
    addGear: (newGear: Omit<GearPiece, 'id'>) => Promise<GearPiece>;
    updateGearPiece: (id: string, updates: Partial<GearPiece>) => Promise<void>;
    deleteGearPiece: (id: string) => Promise<void>;
    loadInventory: () => Promise<void>;
    setData: (data: GearPiece[] | ((prev: GearPiece[]) => GearPiece[])) => Promise<void>;
}

const BATCH_SIZE = 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

interface RawGearStat {
    name: StatName;
    value: number;
    type: StatType;
    is_main: boolean;
}

interface RawShipEquipment {
    ship_id: string;
}

interface RawGearData {
    id: string;
    slot: GearSlotName;
    level: number;
    stars: number;
    rarity: RarityName;
    set_bonus: GearSetName;
    gear_stats: RawGearStat[];
    ship_equipment?: RawShipEquipment[];
}

// Type guard for valid gear piece
const isValidGearPiece = (gear: unknown): gear is GearPiece => {
    if (!gear || typeof gear !== 'object') return false;

    const gearData = gear as Partial<GearPiece>;

    // Check required string properties
    const requiredStringProps = ['id', 'slot', 'rarity', 'setBonus'] as const;
    if (!requiredStringProps.every((prop) => typeof gearData[prop] === 'string')) return false;

    // Check required number properties
    const requiredNumberProps = ['level', 'stars'] as const;
    if (!requiredNumberProps.every((prop) => typeof gearData[prop] === 'number')) return false;

    // Check mainStat object
    if (!gearData.mainStat || typeof gearData.mainStat !== 'object') return false;
    if (typeof gearData.mainStat.name !== 'string' || typeof gearData.mainStat.value !== 'number') {
        return false;
    }

    // Check subStats array
    if (!Array.isArray(gearData.subStats)) return false;
    if (
        !gearData.subStats.every(
            (stat) => typeof stat.name === 'string' && typeof stat.value === 'number'
        )
    ) {
        return false;
    }

    return true;
};

// Helper function to transform Supabase data into GearPiece format
const transformGearData = (data: RawGearData): GearPiece | null => {
    try {
        const mainStat = data.gear_stats?.find((stat) => stat.is_main);
        const subStats = data.gear_stats?.filter((stat) => !stat.is_main) || [];

        const createStat = (stat: RawGearStat): Stat => {
            if (stat.type === 'percentage') {
                return {
                    name: stat.name,
                    value: stat.value,
                    type: 'percentage',
                };
            } else {
                return {
                    name: stat.name as FlexibleStats,
                    value: stat.value,
                    type: 'flat',
                };
            }
        };

        const gear: GearPiece = {
            id: data.id,
            slot: data.slot,
            level: data.level,
            stars: data.stars,
            rarity: data.rarity,
            setBonus: data.set_bonus,
            mainStat: mainStat
                ? createStat(mainStat)
                : {
                      name: 'hp',
                      value: 0,
                      type: 'flat',
                  },
            subStats: subStats.length > 0 ? subStats.map(createStat) : [],
            shipId: data.ship_equipment?.[0]?.ship_id,
        };

        return isValidGearPiece(gear) ? gear : null;
    } catch (error) {
        console.error('Error transforming gear data:', error);
        return null;
    }
};

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [isMigrating, setIsMigrating] = useState(false);

    // Use useStorage for inventory
    const { data: inventory, setData: setInventory } = useStorage<GearPiece[]>({
        key: StorageKey.INVENTORY,
        defaultValue: [],
    });

    const loadBatch = useCallback(
        async (
            lastId: string | null,
            retryCount = 0
        ): Promise<{ items: GearPiece[]; lastId: string | null }> => {
            if (!user?.id) return { items: [], lastId: null };

            try {
                let query = supabase
                    .from('inventory_items')
                    .select(
                        `
                    *,
                    gear_stats (*),
                    ship_equipment (ship_id)
                `
                    )
                    .eq('user_id', user.id)
                    .order('id')
                    .limit(BATCH_SIZE);

                // Only add gt condition if we have a lastId
                if (lastId) {
                    query = query.gt('id', lastId);
                }

                const { data, error } = await query;

                if (error) throw error;

                const transformedGear = data
                    .map(transformGearData)
                    .filter((gear): gear is GearPiece => gear !== null)
                    .map((gear) => ({
                        ...gear,
                        subStats: gear.subStats || [],
                    }));

                return {
                    items: transformedGear,
                    lastId: data[data.length - 1]?.id || null,
                };
            } catch (error) {
                if (retryCount < MAX_RETRIES) {
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
                    return loadBatch(lastId, retryCount + 1);
                }
                throw error;
            }
        },
        [user?.id]
    );

    const loadInventory = useCallback(async () => {
        // Skip loading if we're in the middle of migration
        if (isMigrating) return;

        try {
            if (!user?.id) return;

            setLoading(true);
            setLoadingProgress(0);
            let allItems: GearPiece[] = [];
            let lastId: string | null = null;
            let totalLoaded = 0;

            // First, get the total count
            const { count, error: countError } = await supabase
                .from('inventory_items')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', user?.id);

            if (countError) throw countError;
            const totalItems = count || 0;

            // Load all batches
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { items, lastId: newLastId } = await loadBatch(lastId);

                if (items.length === 0) break;

                allItems = [...allItems, ...items];
                lastId = newLastId;
                totalLoaded += items.length;

                // Update progress
                setLoadingProgress(Math.round((totalLoaded / totalItems) * 100));

                // Update inventory as we go
                setInventory(allItems);

                if (items.length < BATCH_SIZE) break;
            }

            setLoadingProgress(100);
        } catch (error) {
            console.error('Error loading inventory:', error);
            addNotification('error', 'Failed to load inventory');
            // Keep existing inventory on error
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification, setInventory, isMigrating, loadBatch]);

    // Initial load and reload on auth changes
    useEffect(() => {
        loadInventory();
    }, [user?.id, loadInventory]);

    useEffect(() => {
        const handleSignOut = () => {
            // Only clear data if we're not in the middle of migration
            if (!isMigrating) {
                setInventory([]);
            }
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setInventory, isMigrating]);

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

    const getGearPiece = useCallback(
        (id: string) => inventory.find((gear) => gear.id === id),
        [inventory]
    );

    const addGear = useCallback(
        async (newGear: Omit<GearPiece, 'id'>) => {
            const tempId = `gear-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            try {
                // Ensure all properties are properly initialized
                const optimisticGear: GearPiece = {
                    ...newGear,
                    id: tempId,
                    subStats: newGear.subStats || [],
                };

                // Optimistic update
                setInventory((prev) => [...prev, optimisticGear]);

                if (!user?.id) return optimisticGear;

                // Create gear record
                const { data: gearData, error: gearError } = await supabase
                    .from('inventory_items')
                    .insert({
                        user_id: user.id,
                        slot: newGear.slot,
                        level: newGear.level,
                        stars: newGear.stars,
                        rarity: newGear.rarity,
                        set_bonus: newGear.setBonus,
                    })
                    .select()
                    .single();

                if (gearError || !gearData) throw gearError;

                // Create gear stats
                const stats = [
                    {
                        gear_id: gearData.id,
                        name: newGear.mainStat.name,
                        value: newGear.mainStat.value,
                        type: newGear.mainStat.type,
                        is_main: true,
                    },
                    ...(newGear.subStats || []).map((stat) => ({
                        gear_id: gearData.id,
                        name: stat.name,
                        value: stat.value,
                        type: stat.type,
                        is_main: false,
                    })),
                ];

                const { error: statsError } = await supabase.from('gear_stats').insert(stats);

                if (statsError) throw statsError;

                // Update state with real data
                await loadInventory();
                return transformGearData(gearData as RawGearData) as GearPiece;
            } catch (error) {
                // Revert optimistic update on error
                setInventory((prev) => prev.filter((g) => g.id !== tempId));
                console.error('Error adding gear:', error);
                addNotification('error', 'Failed to add gear');
                throw error;
            }
        },
        [user?.id, loadInventory, addNotification, setInventory]
    );

    const updateGearPiece = useCallback(
        async (id: string, updates: Partial<GearPiece>) => {
            try {
                // Get the current piece to update
                const currentPiece = inventory.find((gear) => gear.id === id);
                if (!currentPiece) {
                    throw new Error('Gear piece not found');
                }

                // Create updated piece with merged changes
                const updatedPiece = {
                    ...currentPiece,
                    ...updates,
                    // Ensure subStats are initialized
                    subStats: updates.subStats || currentPiece.subStats || [],
                };

                // Optimistic update
                setInventory((prev) => prev.map((gear) => (gear.id === id ? updatedPiece : gear)));

                if (!user?.id) return;

                // Update gear record
                const { error: gearError } = await supabase
                    .from('inventory_items')
                    .update({
                        slot: updatedPiece.slot,
                        level: updatedPiece.level,
                        stars: updatedPiece.stars,
                        rarity: updatedPiece.rarity,
                        set_bonus: updatedPiece.setBonus,
                    })
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (gearError) throw gearError;

                // Update gear stats if provided
                if (updates.mainStat || updates.subStats) {
                    // Delete existing stats
                    const { error: deleteError } = await supabase
                        .from('gear_stats')
                        .delete()
                        .eq('gear_id', id);

                    if (deleteError) throw deleteError;

                    // Insert new stats
                    const stats = [
                        {
                            gear_id: id,
                            name: updatedPiece.mainStat.name,
                            value: updatedPiece.mainStat.value,
                            type: updatedPiece.mainStat.type,
                            is_main: true,
                        },
                        ...(updatedPiece.subStats?.map((stat) => ({
                            gear_id: id,
                            name: stat.name,
                            value: stat.value,
                            type: stat.type,
                            is_main: false,
                        })) || []),
                    ].filter(Boolean);

                    if (stats.length > 0) {
                        const { error: statsError } = await supabase
                            .from('gear_stats')
                            .insert(stats);

                        if (statsError) throw statsError;
                    }
                }

                // Only reload if we're authenticated - for unauthenticated users we rely on the optimistic update
                if (user?.id) {
                    await loadInventory();
                }
            } catch (error) {
                // Revert optimistic update on error
                await loadInventory();
                console.error('Error updating gear:', error);
                addNotification('error', 'Failed to update gear');
                throw error;
            }
        },
        [user?.id, loadInventory, addNotification, inventory, setInventory]
    );

    const deleteGearPiece = useCallback(
        async (id: string) => {
            try {
                // Optimistic update
                setInventory((prev) => prev.filter((gear) => gear.id !== id));

                if (!user?.id) return;

                // Delete gear record (this will cascade delete related records)
                const { error } = await supabase
                    .from('inventory_items')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (error) throw error;

                // Only reload if we're authenticated - for unauthenticated users we rely on the optimistic update
                if (user?.id) {
                    await loadInventory();
                }
            } catch (error) {
                // Revert optimistic update on error
                await loadInventory();
                console.error('Error deleting gear:', error);
                addNotification('error', 'Failed to delete gear');
                throw error;
            }
        },
        [user?.id, loadInventory, addNotification, setInventory]
    );

    return (
        <InventoryContext.Provider
            value={{
                inventory,
                loading,
                loadingProgress,
                getGearPiece,
                addGear,
                updateGearPiece,
                deleteGearPiece,
                loadInventory,
                setData: setInventory,
            }}
        >
            {children}
        </InventoryContext.Provider>
    );
};

export const useInventory = () => {
    const context = useContext(InventoryContext);
    if (context === undefined) {
        throw new Error('useInventory must be used within an InventoryProvider');
    }
    return context;
};
