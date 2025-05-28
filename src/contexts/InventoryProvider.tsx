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
    getGearPiece: (id: string) => GearPiece | undefined;
    addGear: (newGear: Omit<GearPiece, 'id'>) => Promise<GearPiece>;
    updateGearPiece: (id: string, updates: Partial<GearPiece>) => Promise<void>;
    deleteGearPiece: (id: string) => Promise<void>;
    loadInventory: () => Promise<void>;
    setData: (data: GearPiece[] | ((prev: GearPiece[]) => GearPiece[])) => Promise<void>;
}

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
    // Use useStorage for inventory
    const { data: inventory, setData: setInventory } = useStorage<GearPiece[]>({
        key: StorageKey.INVENTORY,
        defaultValue: [],
    });

    const loadInventory = useCallback(async () => {
        try {
            setLoading(true);
            if (user?.id) {
                const { data, error } = await supabase
                    .from('inventory_items')
                    .select(
                        `
                        *,
                        gear_stats (*),
                        ship_equipment (*)
                    `
                    )
                    .eq('user_id', user.id);

                if (error) throw error;
                const transformedGear = data
                    .map(transformGearData)
                    .filter((gear): gear is GearPiece => gear !== null)
                    .map((gear) => ({
                        ...gear,
                        subStats: gear.subStats || [],
                    }));

                setInventory(transformedGear);
            }
            // Don't clear inventory when user is not authenticated
        } catch (error) {
            console.error('Error loading inventory:', error);
            addNotification('error', 'Failed to load inventory');
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification, setInventory]);

    // Initial load and reload on auth changes
    useEffect(() => {
        loadInventory();
    }, [user?.id, loadInventory]);

    // Ensure gear pieces are properly initialized for all users
    useEffect(() => {
        if (inventory.length > 0) {
            const updatedInventory = inventory.map((gear) => ({
                ...gear,
                subStats: gear.subStats || [],
            }));

            if (JSON.stringify(updatedInventory) !== JSON.stringify(inventory)) {
                setInventory(updatedInventory);
            }
        }
    }, [inventory, setInventory]);

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

    useEffect(() => {
        const handleSignOut = () => {
            setInventory([]);
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setInventory]);

    return (
        <InventoryContext.Provider
            value={{
                inventory,
                loading,
                loadInventory,
                getGearPiece,
                addGear,
                updateGearPiece,
                deleteGearPiece,
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
