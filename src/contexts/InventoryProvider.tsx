import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import { GearPiece } from '../types/gear';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthProvider';
import { Stat, StatName, StatType, FlexibleStats } from '../types/stats';
import { GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { GearSetName } from '../constants/gearSets';

interface InventoryContextType {
    inventory: GearPiece[];
    loading: boolean;
    getGearPiece: (id: string) => GearPiece | undefined;
    addGear: (newGear: Omit<GearPiece, 'id'>) => Promise<GearPiece>;
    updateGearPiece: (id: string, updates: Partial<GearPiece>) => Promise<void>;
    deleteGearPiece: (id: string) => Promise<void>;
    loadInventory: () => Promise<void>;
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
        const mainStat = data.gear_stats.find((stat) => stat.is_main);
        const subStats = data.gear_stats.filter((stat) => !stat.is_main);

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
            subStats: subStats.map(createStat),
            shipId: data.ship_equipment?.[0]?.ship_id,
        };

        return isValidGearPiece(gear) ? gear : null;
    } catch (error) {
        console.error('Error transforming gear data:', error);
        return null;
    }
};

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [inventory, setInventory] = useState<GearPiece[]>([]);
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();
    const { user } = useAuth();

    // Load all inventory data with a single query
    const loadInventory = useCallback(async () => {
        if (!user?.id) return;

        try {
            setLoading(true);
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
                .filter((gear): gear is GearPiece => gear !== null);

            setInventory(transformedGear);
        } catch (error) {
            console.error('Error loading inventory:', error);
            addNotification('error', 'Failed to load inventory');
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification]);

    // Initial load and reload on auth changes
    useEffect(() => {
        loadInventory();
    }, [loadInventory]);

    const getGearPiece = useCallback(
        (id: string) => inventory.find((gear) => gear.id === id),
        [inventory]
    );

    const addGear = useCallback(
        async (newGear: Omit<GearPiece, 'id'>) => {
            if (!user?.id) throw new Error('User not authenticated');

            const tempId = `temp-${Date.now()}`;
            try {
                // Optimistic update
                const optimisticGear: GearPiece = {
                    ...newGear,
                    id: tempId,
                };
                setInventory((prev) => [...prev, optimisticGear]);

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
                    ...newGear.subStats.map((stat) => ({
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
        [user?.id, loadInventory, addNotification]
    );

    const updateGearPiece = useCallback(
        async (id: string, updates: Partial<GearPiece>) => {
            if (!user?.id) throw new Error('User not authenticated');

            try {
                // Optimistic update
                setInventory((prev) =>
                    prev.map((gear) => (gear.id === id ? { ...gear, ...updates } : gear))
                );

                // Update gear record
                const { error: gearError } = await supabase
                    .from('inventory_items')
                    .update({
                        slot: updates.slot,
                        level: updates.level,
                        stars: updates.stars,
                        rarity: updates.rarity,
                        set_bonus: updates.setBonus,
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
                        updates.mainStat
                            ? {
                                  gear_id: id,
                                  name: updates.mainStat.name,
                                  value: updates.mainStat.value,
                                  type: updates.mainStat.type,
                                  is_main: true,
                              }
                            : null,
                        ...(updates.subStats?.map((stat) => ({
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

                // Update state with real data
                await loadInventory();
            } catch (error) {
                // Revert optimistic update on error
                await loadInventory();
                console.error('Error updating gear:', error);
                addNotification('error', 'Failed to update gear');
                throw error;
            }
        },
        [user?.id, loadInventory, addNotification]
    );

    const deleteGearPiece = useCallback(
        async (id: string) => {
            if (!user?.id) throw new Error('User not authenticated');

            try {
                // Optimistic update
                setInventory((prev) => prev.filter((gear) => gear.id !== id));

                // Delete gear record (this will cascade delete related records)
                const { error } = await supabase
                    .from('inventory_items')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadInventory();
                console.error('Error deleting gear:', error);
                addNotification('error', 'Failed to delete gear');
                throw error;
            }
        },
        [user?.id, loadInventory, addNotification]
    );

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
