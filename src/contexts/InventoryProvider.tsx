import React, { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { GearPiece } from '../types/gear';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';
import { Stat, StatName, StatType, FlexibleStats } from '../types/stats';
import { GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { GearSetName } from '../constants/gearSets';
import { useStorage, removeFromIndexedDB } from '../hooks/useStorage';
import { StorageKey } from '../constants/storage';
import { useActiveProfile, PROFILE_SWITCH_EVENT } from './ActiveProfileProvider';

interface InventoryContextType {
    inventory: GearPiece[];
    loading: boolean;
    loadingProgress: number;
    syncing: boolean;
    getGearPiece: (id: string) => GearPiece | undefined;
    addGear: (newGear: Omit<GearPiece, 'id'>) => Promise<GearPiece>;
    updateGearPiece: (id: string, updates: Partial<GearPiece>) => Promise<void>;
    deleteGearPiece: (id: string) => Promise<void>;
    loadInventory: () => Promise<void>;
    setData: (data: GearPiece[] | ((prev: GearPiece[]) => GearPiece[])) => Promise<void>;
}

const BATCH_SIZE = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

interface RawStatData {
    name: StatName;
    value: number;
    type: StatType;
}

interface RawStatsJsonb {
    mainStat: RawStatData | null;
    subStats: RawStatData[];
}

interface RawGearData {
    id: string;
    slot: GearSlotName;
    level: number;
    stars: number;
    rarity: RarityName;
    set_bonus: GearSetName;
    calibration_ship_id?: string | null;
    stats: RawStatsJsonb | null;
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
        const statsData = data.stats;

        const createStat = (stat: RawStatData): Stat => {
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
            mainStat: statsData?.mainStat
                ? createStat(statsData.mainStat)
                : {
                      name: 'hp',
                      value: 0,
                      type: 'flat',
                  },
            subStats: statsData?.subStats?.length ? statsData.subStats.map(createStat) : [],
            // Include calibration if calibration_ship_id exists
            ...(data.calibration_ship_id && {
                calibration: {
                    shipId: data.calibration_ship_id,
                },
            }),
        };

        return isValidGearPiece(gear) ? gear : null;
    } catch (error) {
        console.error('Error transforming gear data:', error);
        return null;
    }
};

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { addNotification } = useNotification();
    const { activeProfileId, profilesLoading } = useActiveProfile();
    // Initialize loading to false so unauthenticated / demo users are never stranded.
    // loadInventory sets it to true before async work, so the authenticated path is correct.
    const [loading, setLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [syncing, setSyncing] = useState(false);
    const [isMigrating, setIsMigrating] = useState(false);
    const [tempInventory, setTempInventory] = useState<GearPiece[]>([]);
    const [localInventory, setLocalInventory] = useState<GearPiece[]>([]);
    const [cacheLoaded, setCacheLoaded] = useState(false);

    // One-time wipe of the legacy unkeyed inventory cache entry.
    // Before this task, all profiles shared a single "inventory_items" IndexedDB key.
    // Now each profile gets its own key ("inventory_items:<profileId>").
    // On first load after deploy, delete the old entry so stale data isn't served.
    useEffect(() => {
        const MIGRATION_FLAG = 'inventory_cache_v2_migrated';
        if (!localStorage.getItem(MIGRATION_FLAG)) {
            // Wipe the legacy unkeyed inventory cache once. Future reads use profile-keyed entries.
            void removeFromIndexedDB(StorageKey.INVENTORY);
            localStorage.setItem(MIGRATION_FLAG, 'true');
        }
    }, []);

    // Build the profile-scoped IndexedDB cache key.
    // When activeProfileId is null (unauthenticated / demo), fall back to the legacy
    // base key so offline/demo users still get a persistent cache.
    const inventoryCacheKey = activeProfileId
        ? `${StorageKey.INVENTORY}:${activeProfileId}`
        : StorageKey.INVENTORY;

    // Use useStorage for inventory
    const { data: storageInventory, setData: setStorageInventory } = useStorage<GearPiece[]>({
        key: inventoryCacheKey,
        defaultValue: [],
        useIndexedDB: true,
    });

    // Synchronize local state with storage (IndexedDB cache)
    useEffect(() => {
        if (storageInventory) {
            setLocalInventory(storageInventory);
            if (storageInventory.length > 0) {
                setCacheLoaded(true);
            }
        }
    }, [storageInventory]);

    // Synchronize local state back to storage
    const syncToStorage = useCallback(
        async (newInventory: GearPiece[] | ((prev: GearPiece[]) => GearPiece[])) => {
            if (typeof newInventory === 'function') {
                await setStorageInventory(newInventory(localInventory));
            } else {
                await setStorageInventory(newInventory);
            }
        },
        [setStorageInventory, localInventory]
    );

    const loadBatch = useCallback(
        async (
            lastId: string | null,
            retryCount = 0
        ): Promise<{ items: GearPiece[]; lastId: string | null }> => {
            if (!activeProfileId) return { items: [], lastId: null };

            try {
                let query = supabase
                    .from('inventory_items')
                    .select('*')
                    .eq('user_id', activeProfileId)
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
        [activeProfileId]
    );

    const loadInventory = useCallback(async () => {
        // Skip loading if we're in the middle of migration
        if (isMigrating) return;

        try {
            if (!activeProfileId) return;

            // If we have cached data, use syncing mode instead of full loading
            const hasCachedData = localInventory.length > 0;
            if (hasCachedData) {
                setSyncing(true);
                setLoading(false);
            } else {
                setLoading(true);
            }
            setLoadingProgress(0);
            let allItems: GearPiece[] = [];
            let lastId: string | null = null;
            let totalLoaded = 0;

            // First, get the total count
            const { count, error: countError } = await supabase
                .from('inventory_items')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', activeProfileId);

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

                // Update temporary inventory with the latest batch (only when not syncing)
                if (!hasCachedData) {
                    setTempInventory(allItems);
                }

                if (items.length < BATCH_SIZE) break;
            }

            // Once all items are loaded, update the main inventory and
            // cache to IndexedDB so the next visit can hydrate instantly
            // via the `cacheLoaded` fast path instead of blocking on Supabase.
            setLocalInventory(allItems);
            void setStorageInventory(allItems);
            setLoadingProgress(100);
        } catch (error) {
            console.error('Error loading inventory:', error);
            addNotification('error', 'Failed to load inventory');
            // Keep existing inventory on error
        } finally {
            setLoading(false);
            setSyncing(false);
        }
    }, [
        activeProfileId,
        addNotification,
        loadBatch,
        setTempInventory,
        isMigrating,
        localInventory.length,
        setStorageInventory,
    ]);

    // Use tempInventory for display while doing a fresh load (no cache), otherwise use localInventory
    const displayInventory = loading && !cacheLoaded ? tempInventory : localInventory;

    // Initial load and reload on auth/profile changes.
    // Gated on activeProfileId !== null && !profilesLoading so we don't fire
    // before the profile system has resolved — avoids premature empty loads.
    useEffect(() => {
        if (activeProfileId !== null && !profilesLoading) {
            void loadInventory();
        }
    }, [activeProfileId, profilesLoading, loadInventory]);

    // Global load/sync notifications — fired from the provider so they reach the
    // user regardless of which page is mounted when a sign-in triggers a load.
    // Gated on activeProfileId so the initial mount (before auth resolves) doesn't
    // produce a spurious "Loading... 0%" / "Loaded 0" pair.
    const wasLoadingRef = useRef(false);
    const wasSyncingRef = useRef(false);
    useEffect(() => {
        if (!activeProfileId) {
            wasLoadingRef.current = loading;
            return;
        }
        if (loading && !wasLoadingRef.current) {
            addNotification('info', `Loading gear...`);
        }
        if (!loading && wasLoadingRef.current) {
            addNotification('success', `Loaded ${localInventory.length} gear pieces`);
        }
        wasLoadingRef.current = loading;
    }, [loading, loadingProgress, addNotification, localInventory.length, activeProfileId]);

    useEffect(() => {
        if (!activeProfileId) {
            wasSyncingRef.current = syncing;
            return;
        }
        if (syncing && !wasSyncingRef.current) {
            addNotification('info', 'Syncing gear...');
        }
        wasSyncingRef.current = syncing;
    }, [syncing, addNotification, activeProfileId]);

    useEffect(() => {
        const handleSignOut = () => {
            // Only clear data if we're not in the middle of migration
            if (!isMigrating) {
                // Clear through useStorage so IndexedDB is wiped too —
                // otherwise a refresh re-hydrates the signed-out user's inventory.
                void setStorageInventory([]);
            }
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setStorageInventory, isMigrating]);

    // Reset in-memory inventory state when the active profile changes.
    // The activeProfileId-keyed loadInventory effect will refetch automatically.
    useEffect(() => {
        const onSwitch = () => {
            setLocalInventory([]);
            setCacheLoaded(false);
            // Also clear storage so the storageInventory→localInventory sync effect doesn't
            // repopulate localInventory with the previous profile's data before loadInventory
            // fires for the new profile.
            void setStorageInventory([]);
        };
        window.addEventListener(PROFILE_SWITCH_EVENT, onSwitch);
        return () => window.removeEventListener(PROFILE_SWITCH_EVENT, onSwitch);
    }, [setStorageInventory]);

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
        (id: string) => localInventory.find((gear) => gear.id === id),
        [localInventory]
    );

    const addGear = useCallback(
        async (newGear: Omit<GearPiece, 'id'>) => {
            const tempId = uuidv4();
            try {
                // Ensure all properties are properly initialized
                const optimisticGear: GearPiece = {
                    ...newGear,
                    id: tempId,
                    subStats: newGear.subStats || [],
                };

                // Optimistic update using local state
                setLocalInventory((prev) => [...prev, optimisticGear]);
                void syncToStorage([...localInventory, optimisticGear]);

                if (!activeProfileId) return optimisticGear;

                // Create gear record with stats JSONB
                const statsJsonb = {
                    mainStat: newGear.mainStat
                        ? {
                              name: newGear.mainStat.name,
                              value: newGear.mainStat.value,
                              type: newGear.mainStat.type,
                          }
                        : null,
                    subStats: (newGear.subStats || []).map((stat) => ({
                        name: stat.name,
                        value: stat.value,
                        type: stat.type,
                    })),
                };

                const { data: gearData, error: gearError } = await supabase
                    .from('inventory_items')
                    .insert({
                        user_id: activeProfileId,
                        slot: newGear.slot,
                        level: newGear.level,
                        stars: newGear.stars,
                        rarity: newGear.rarity,
                        set_bonus: newGear.setBonus,
                        calibration_ship_id: newGear.calibration?.shipId || null,
                        stats: statsJsonb,
                    })
                    .select()
                    .single();

                if (gearError || !gearData) throw gearError;

                // Update state with real data
                //await loadInventory();
                return transformGearData(gearData as RawGearData) as GearPiece;
            } catch (error) {
                // Revert optimistic update on error
                setLocalInventory((prev) => prev.filter((g) => g.id !== tempId));
                void syncToStorage(localInventory.filter((g) => g.id !== tempId));
                console.error('Error adding gear:', error);
                addNotification('error', 'Failed to add gear');
                throw error;
            }
        },
        [activeProfileId, addNotification, localInventory, syncToStorage]
    );

    const updateGearPiece = useCallback(
        async (id: string, updates: Partial<GearPiece>) => {
            try {
                // Get the current piece to update from local state
                const currentPiece = localInventory.find((gear) => gear.id === id);
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

                // Optimistic update using local state
                const updatedInventory = localInventory.map((gear) =>
                    gear.id === id ? updatedPiece : gear
                );
                setLocalInventory(updatedInventory);
                void syncToStorage(updatedInventory);

                if (!activeProfileId) return;

                // Build update object
                const updateData: Record<string, unknown> = {
                    slot: updatedPiece.slot,
                    level: updatedPiece.level,
                    stars: updatedPiece.stars,
                    rarity: updatedPiece.rarity,
                    set_bonus: updatedPiece.setBonus,
                    calibration_ship_id: updatedPiece.calibration?.shipId || null,
                };

                // Update stats JSONB if stats are being updated
                if (updates.mainStat || updates.subStats) {
                    updateData.stats = {
                        mainStat: updatedPiece.mainStat
                            ? {
                                  name: updatedPiece.mainStat.name,
                                  value: updatedPiece.mainStat.value,
                                  type: updatedPiece.mainStat.type,
                              }
                            : null,
                        subStats: (updatedPiece.subStats || []).map((stat) => ({
                            name: stat.name,
                            value: stat.value,
                            type: stat.type,
                        })),
                    };
                }

                // Update gear record
                const { error: gearError } = await supabase
                    .from('inventory_items')
                    .update(updateData)
                    .eq('id', id)
                    .eq('user_id', activeProfileId);

                if (gearError) throw gearError;
            } catch (error) {
                // Revert optimistic update on error
                await loadInventory();
                console.error('Error updating gear:', error);
                addNotification('error', 'Failed to update gear');
                throw error;
            }
        },
        [activeProfileId, loadInventory, addNotification, localInventory, syncToStorage]
    );

    const deleteGearPiece = useCallback(
        async (id: string) => {
            try {
                // Optimistic update using local state
                const updatedInventory = localInventory.filter((gear) => gear.id !== id);
                setLocalInventory(updatedInventory);
                void syncToStorage(updatedInventory);

                if (activeProfileId) {
                    // Delete gear record (this will cascade delete related records)
                    const { error } = await supabase
                        .from('inventory_items')
                        .delete()
                        .eq('id', id)
                        .eq('user_id', activeProfileId);

                    if (error) throw error;
                }
            } catch (error) {
                // Revert optimistic update on error
                await loadInventory();
                console.error('Error deleting gear:', error);
                addNotification('error', 'Failed to delete gear');
                throw error;
            }
        },
        [activeProfileId, loadInventory, addNotification, localInventory, syncToStorage]
    );

    return (
        <InventoryContext.Provider
            value={{
                inventory: displayInventory,
                loading,
                loadingProgress,
                syncing,
                getGearPiece,
                addGear,
                updateGearPiece,
                deleteGearPiece,
                loadInventory,
                setData: syncToStorage,
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
