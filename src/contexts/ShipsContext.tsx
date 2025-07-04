import React, { createContext, useContext, useCallback, useState, useEffect, useMemo } from 'react';
import { Ship, AffinityName } from '../types/ship';
import { GearSlotName } from '../constants/gearTypes';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthProvider';
import { useNotification } from '../hooks/useNotification';
import { v4 as uuidv4 } from 'uuid';
import { Stat, StatName, StatType, FlexibleStats } from '../types/stats';
import { ShipTypeName } from '../constants/shipTypes';
import { RarityName } from '../constants/rarities';
import { FactionName } from '../constants/factions';
import { useStorage } from '../hooks/useStorage';
import { StorageKey } from '../constants/storage';

interface ShipsContextType {
    ships: Ship[];
    loading: boolean;
    error: string | null;
    editingShip: Ship | undefined;
    setEditingShip: (ship: Ship | undefined) => void;
    getShipName: (id: string) => string | undefined;
    getShipById: (id: string) => Ship | undefined;
    addShip: (newShip: Omit<Ship, 'id'>) => Promise<Ship>;
    updateShip: (id: string, updates: Partial<Ship>) => Promise<void>;
    deleteShip: (id: string) => Promise<void>;
    equipGear: (shipId: string, slot: GearSlotName, gearId: string) => Promise<void>;
    equipMultipleGear: (
        shipId: string,
        gearAssignments: { slot: GearSlotName; gearId: string }[]
    ) => Promise<void>;
    removeGear: (shipId: string, slot: GearSlotName) => Promise<void>;
    lockEquipment: (shipId: string, locked: boolean) => Promise<void>;
    toggleEquipmentLock: (shipId: string) => Promise<void>;
    validateGearAssignments: () => void;
    unequipAllEquipment: (shipId: string) => Promise<void>;
    getShipFromGearId: (gearId: string) => Ship | undefined;
    gearToShipMap: Map<string, string>;
    setData: (data: Ship[] | ((prev: Ship[]) => Ship[])) => Promise<void>;
    loadShips: () => Promise<void>;
}

interface RawShipStat {
    name: StatName;
    value: number;
    type: StatType;
    id: string;
}

interface RawShipEquipment {
    slot: GearSlotName;
    gear_id: string;
}

interface RawShipRefit {
    id: string;
    ship_refit_stats: RawShipStat[];
}

interface RawShipImplant {
    id: string;
    slot: GearSlotName;
    description?: string;
}

interface RawShipBaseStats {
    hp: number;
    attack: number;
    defence: number;
    hacking: number;
    security: number;
    crit: number;
    crit_damage: number;
    speed: number;
    heal_modifier: number;
    hp_regen: number;
    shield: number;
    defense_penetration: number;
}

interface RawShipData {
    id: string;
    name: string;
    rarity: RarityName;
    faction: FactionName;
    type: ShipTypeName;
    affinity: AffinityName;
    copies: number;
    rank: number;
    level: number;
    ship_base_stats: RawShipBaseStats;
    ship_equipment: RawShipEquipment[];
    equipment_locked: boolean;
    ship_refits: RawShipRefit[];
    ship_implants: RawShipImplant[];
    ship_templates: {
        image_key: string;
    };
}

// Type guard for valid ship data
const isValidShip = (ship: unknown): ship is Ship => {
    if (!ship || typeof ship !== 'object') {
        console.error('Invalid ship: Not an object or is null/undefined');
        return false;
    }

    const shipData = ship as Partial<Ship>;

    // Check required string properties
    const requiredStringProps = ['id', 'name', 'type', 'faction', 'rarity'] as const;
    const missingStringProps = requiredStringProps.filter(
        (prop) => typeof shipData[prop] !== 'string'
    );
    if (missingStringProps.length > 0) {
        console.error('Invalid ship: Missing or invalid string properties:', missingStringProps);
        return false;
    }

    // Check equipment object
    if (!shipData.equipment || typeof shipData.equipment !== 'object') {
        console.error('Invalid ship: Missing or invalid equipment object');
        return false;
    }

    // Check baseStats object
    const requiredBaseStats = [
        'hp',
        'attack',
        'defence',
        'speed',
        'hacking',
        'security',
        'crit',
        'critDamage',
        'healModifier',
    ] as const;
    if (!shipData.baseStats || typeof shipData.baseStats !== 'object') {
        console.error('Invalid ship: Missing or invalid baseStats object');
        return false;
    }

    const missingBaseStats = requiredBaseStats.filter(
        (stat) => typeof shipData.baseStats?.[stat] !== 'number'
    );
    if (missingBaseStats.length > 0) {
        console.error('Invalid ship: Missing or invalid base stats:', missingBaseStats);
        return false;
    }

    // Check arrays
    if (!Array.isArray(shipData.refits)) {
        console.error('Invalid ship: refits is not an array');
        return false;
    }

    // Check equipmentLocked boolean
    if (shipData.equipmentLocked !== undefined && typeof shipData.equipmentLocked !== 'boolean') {
        console.error('Invalid ship: equipmentLocked is not a boolean');
        return false;
    }

    // Check optional properties
    if (shipData.affinity !== undefined && typeof shipData.affinity !== 'string') {
        console.error('Invalid ship: affinity is not a string');
        return false;
    }

    return true;
};

// Helper function to transform Supabase data into Ship format
const transformShipData = (data: RawShipData): Ship | null => {
    try {
        const createStat = (stat: RawShipStat): Stat => {
            if (stat.type === 'percentage') {
                return {
                    name: stat.name,
                    value: stat.value,
                    type: 'percentage',
                    id: stat.id,
                };
            } else {
                return {
                    name: stat.name as FlexibleStats,
                    value: stat.value,
                    type: 'flat',
                    id: stat.id,
                };
            }
        };

        const ship: Ship = {
            id: data.id,
            name: data.name,
            rarity: data.rarity,
            faction: data.faction,
            type: data.type,
            affinity: data.affinity,
            copies: data.copies || 1,
            rank: data.rank,
            level: data.level,
            baseStats: {
                hp: data.ship_base_stats.hp,
                attack: data.ship_base_stats.attack,
                defence: data.ship_base_stats.defence,
                hacking: data.ship_base_stats.hacking,
                security: data.ship_base_stats.security,
                crit: data.ship_base_stats.crit,
                critDamage: data.ship_base_stats.crit_damage,
                speed: data.ship_base_stats.speed,
                healModifier: data.ship_base_stats.heal_modifier,
                hpRegen: data.ship_base_stats.hp_regen,
                shield: data.ship_base_stats.shield,
                defensePenetration: data.ship_base_stats.defense_penetration,
            },
            equipment: data.ship_equipment.reduce(
                (acc: Record<GearSlotName, string>, eq) => {
                    acc[eq.slot] = eq.gear_id;
                    return acc;
                },
                {} as Record<GearSlotName, string>
            ),
            equipmentLocked: data.equipment_locked || false,
            refits: data.ship_refits.map((refit) => ({
                id: refit.id,
                stats: refit.ship_refit_stats.map(createStat),
            })),
            implants: data.ship_implants.reduce(
                (acc: Record<GearSlotName, string>, implant) => {
                    acc[implant.slot] = implant.description || implant.id;
                    return acc;
                },
                {} as Record<GearSlotName, string>
            ),
            imageKey: data.ship_templates.image_key,
        };
        return isValidShip(ship) ? ship : null;
    } catch (error) {
        console.error('Error transforming ship data:', error);
        return null;
    }
};

const ShipsContext = createContext<ShipsContextType | undefined>(undefined);

export const ShipsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingShip, setEditingShip] = useState<Ship | undefined>();
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const [isMigrating, setIsMigrating] = useState(false);
    const [localShips, setLocalShips] = useState<Ship[]>([]);

    // Use useStorage for ships
    const { data: storageShips, setData: setStorageShips } = useStorage<Ship[]>({
        key: StorageKey.SHIPS,
        defaultValue: [],
    });

    // Memoized gear-to-ship mapping for O(1) lookups
    const gearToShipMap = useMemo(() => {
        const map = new Map<string, string>();
        localShips.forEach((ship) => {
            Object.entries({ ...ship.equipment, ...ship.implants }).forEach(([_, gearId]) => {
                if (gearId) {
                    map.set(gearId, ship.id);
                }
            });
        });
        return map;
    }, [localShips]);

    // Synchronize local state with storage
    useEffect(() => {
        if (storageShips) {
            setLocalShips(storageShips);
        }
    }, [storageShips]);

    const loadShips = useCallback(async () => {
        // Skip loading if we're in the middle of migration
        if (isMigrating) return;

        try {
            setLoading(true);
            if (user?.id) {
                const { data, error } = await supabase
                    .from('ships')
                    .select(
                        `
                    *,
                    ship_base_stats (*),
                    ship_equipment (*),
                    ship_refits (
                        *,
                        ship_refit_stats (*)
                    ),
                    ship_implants (*),
                    ship_templates!inner (
                        image_key
                    )
                `
                    )
                    .eq('user_id', user.id);

                if (error) throw error;

                const transformedShips = data
                    .map(transformShipData)
                    .filter((ship): ship is Ship => ship !== null)
                    .map((ship) => ({
                        ...ship,
                        equipment: ship.equipment || {},
                    }));

                setLocalShips(transformedShips);
                // Update storage directly instead of using syncToStorage
                await setStorageShips(transformedShips);
            }
        } catch (error) {
            console.error('Error loading ships:', error);
            addNotification('error', 'Failed to load ships');
            setError(error instanceof Error ? error.message : 'Failed to load ships');
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification, setStorageShips, isMigrating]);

    // Initial load and reload on auth changes
    useEffect(() => {
        loadShips();
    }, [user?.id, loadShips]);

    useEffect(() => {
        const handleSignOut = () => {
            // Only clear data if we're not in the middle of migration
            if (!isMigrating) {
                setLocalShips([]);
            }
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setLocalShips, isMigrating]);

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

    // Ensure equipment is properly initialized for all ships
    useEffect(() => {
        if (localShips.length > 0) {
            const updatedShips = localShips.map((ship) => ({
                ...ship,
                equipment: ship.equipment || {},
            }));
            if (JSON.stringify(updatedShips) !== JSON.stringify(localShips)) {
                setLocalShips(updatedShips);
                setStorageShips(updatedShips);
            }
        }
    }, [localShips, setStorageShips]);

    const getShipName = useCallback(
        (id: string) => localShips.find((ship) => ship.id === id)?.name,
        [localShips]
    );

    const getShipById = useCallback(
        (id: string) => localShips.find((ship) => ship.id === id),
        [localShips]
    );

    const addShip = useCallback(
        async (newShip: Omit<Ship, 'id'>) => {
            const tempId = uuidv4();

            const optimisticShip: Ship = {
                ...newShip,
                id: tempId,
            };
            setLocalShips((prev) => [...prev, optimisticShip]);
            setStorageShips([...localShips, optimisticShip]);

            if (!user?.id) return getShipById(tempId) as Ship;

            try {
                // Create ship record
                const shipData = {
                    user_id: user.id,
                    name: newShip.name,
                    type: newShip.type,
                    faction: newShip.faction,
                    rarity: newShip.rarity,
                    affinity: newShip.affinity,
                    equipment_locked: newShip.equipmentLocked,
                    copies: newShip.copies || 1,
                };

                const { data: insertedShip, error: shipError } = await supabase
                    .from('ships')
                    .insert(shipData)
                    .select('*')
                    .single();

                if (shipError) {
                    console.error('Error inserting ship:', shipError);
                    throw shipError;
                }

                if (!insertedShip) {
                    console.error('No data returned after ship insert');
                    throw new Error('No data returned after ship insert');
                }

                // Create base stats
                const { error: statsError } = await supabase.from('ship_base_stats').insert({
                    ship_id: insertedShip.id,
                    hp: newShip.baseStats.hp,
                    attack: newShip.baseStats.attack,
                    defence: newShip.baseStats.defence,
                    hacking: newShip.baseStats.hacking,
                    security: newShip.baseStats.security,
                    crit: newShip.baseStats.crit,
                    crit_damage: newShip.baseStats.critDamage,
                    speed: newShip.baseStats.speed,
                    heal_modifier: newShip.baseStats.healModifier,
                    hp_regen: newShip.baseStats.hpRegen,
                    shield: newShip.baseStats.shield,
                });

                if (statsError) {
                    console.error('Error inserting base stats:', statsError);
                    throw statsError;
                }

                // Create refits
                for (const refit of newShip.refits) {
                    const { data: refitsData, error: refitsError } = await supabase
                        .from('ship_refits')
                        .insert({
                            ship_id: insertedShip.id,
                        })
                        .select('id')
                        .single();

                    if (refitsError) {
                        console.error('Error inserting refit:', refitsError);
                        throw refitsError;
                    }

                    for (const stat of refit.stats) {
                        const { error: refitStatsError } = await supabase
                            .from('ship_refit_stats')
                            .insert({
                                refit_id: refitsData.id,
                                name: stat.name,
                                value: stat.value,
                                type: stat.type,
                            });

                        if (refitStatsError) {
                            console.error('Error inserting refit stats:', refitStatsError);
                            throw refitStatsError;
                        }
                    }
                }

                return getShipById(insertedShip.id) as Ship;
            } catch (error) {
                // Revert optimistic update on error
                setLocalShips((prev) => prev.filter((s) => s.id !== tempId));
                setStorageShips(localShips.filter((s) => s.id !== tempId));
                console.error('Error adding ship:', error);
                addNotification('error', 'Failed to add ship');
                throw error;
            }
        },
        [user?.id, getShipById, addNotification, localShips, setStorageShips]
    );

    const updateShip = useCallback(
        async (id: string, updates: Partial<Ship>) => {
            // Optimistic update
            const updatedShips = localShips.map((ship) =>
                ship.id === id ? { ...ship, ...updates } : ship
            );
            setLocalShips(updatedShips);
            setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                // Update ship record
                const { error: shipError } = await supabase
                    .from('ships')
                    .update({
                        name: updates.name,
                        type: updates.type,
                        faction: updates.faction,
                        rarity: updates.rarity,
                        affinity: updates.affinity,
                        equipment_locked: updates.equipmentLocked,
                    })
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (shipError) throw shipError;

                // Update base stats if provided
                if (updates.baseStats) {
                    const { error: statsError } = await supabase
                        .from('ship_base_stats')
                        .update({
                            hp: updates.baseStats.hp,
                            attack: updates.baseStats.attack,
                            defence: updates.baseStats.defence,
                            hacking: updates.baseStats.hacking,
                            security: updates.baseStats.security,
                            crit: updates.baseStats.crit,
                            crit_damage: updates.baseStats.critDamage,
                            speed: updates.baseStats.speed,
                            heal_modifier: updates.baseStats.healModifier,
                            hp_regen: updates.baseStats.hpRegen,
                            shield: updates.baseStats.shield,
                        })
                        .eq('ship_id', id);

                    if (statsError) throw statsError;
                }

                // Update implants if provided
                if (updates.implants) {
                    // Delete existing implants for this ship
                    const { error: deleteImplantsError } = await supabase
                        .from('ship_implants')
                        .delete()
                        .eq('ship_id', id);

                    if (deleteImplantsError) throw deleteImplantsError;

                    // Insert new implants
                    const implantEntries = Object.entries(updates.implants).filter(
                        ([_, gearId]) => gearId
                    );
                    if (implantEntries.length > 0) {
                        const { error: insertImplantsError } = await supabase
                            .from('ship_implants')
                            .insert(
                                implantEntries.map(([slot, gearId]) => ({
                                    ship_id: id,
                                    slot,
                                    id: gearId,
                                }))
                            );

                        if (insertImplantsError) throw insertImplantsError;
                    }
                }

                if (updates.refits) {
                    for (const refit of updates.refits) {
                        let refitId;
                        if (refit.id) {
                            refitId = refit.id;
                        } else {
                            const { data: refitData, error: refitError } = await supabase
                                .from('ship_refits')
                                .insert({ ship_id: id })
                                .select('id')
                                .single();
                            if (refitError) throw refitError;
                            refitId = refitData.id;
                        }

                        for (const stat of refit.stats) {
                            if (stat.id) {
                                const { error: statError } = await supabase
                                    .from('ship_refit_stats')
                                    .update({
                                        name: stat.name,
                                        value: stat.value,
                                        type: stat.type,
                                    })
                                    .eq('id', stat.id);
                                if (statError) throw statError;
                            } else {
                                const { error: statError } = await supabase
                                    .from('ship_refit_stats')
                                    .insert({
                                        refit_id: refitId,
                                        name: stat.name,
                                        value: stat.value,
                                        type: stat.type,
                                    });
                                if (statError) throw statError;
                            }
                        }
                    }
                }
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error updating ship:', error);
                addNotification('error', 'Failed to update ship');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );

    const deleteShip = useCallback(
        async (id: string) => {
            // Optimistic update
            const updatedShips = localShips.filter((ship) => ship.id !== id);
            setLocalShips(updatedShips);
            setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                // Delete ship record (this will cascade delete related records)
                const { error } = await supabase
                    .from('ships')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error deleting ship:', error);
                addNotification('error', 'Failed to delete ship');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );

    const equipGear = useCallback(
        async (shipId: string, slot: GearSlotName, gearId: string) => {
            // Optimistic update
            const updatedShips = localShips.map((ship) => {
                if (ship.id === shipId) {
                    return {
                        ...ship,
                        equipment: {
                            ...ship.equipment,
                            [slot]: gearId,
                        },
                    };
                }
                // For all other ships, remove this gear if it's equipped
                const equipment = { ...ship.equipment };
                Object.entries(equipment).forEach(([key, value]) => {
                    if (value === gearId) {
                        equipment[key as GearSlotName] = undefined;
                    }
                });
                return {
                    ...ship,
                    equipment,
                };
            });
            setLocalShips(updatedShips);
            setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                // Delete existing equipment
                const { error: deleteError } = await supabase
                    .from('ship_equipment')
                    .delete()
                    .eq('gear_id', gearId);

                if (deleteError) throw deleteError;

                // Update equipment in database
                const { error } = await supabase
                    .from('ship_equipment')
                    .upsert({
                        ship_id: shipId,
                        slot,
                        gear_id: gearId,
                    })
                    .eq('ship_id', shipId)
                    .eq('slot', slot);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error equipping gear:', error);
                addNotification('error', 'Failed to equip gear');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );

    const equipMultipleGear = useCallback(
        async (shipId: string, gearAssignments: { slot: GearSlotName; gearId: string }[]) => {
            // Optimistic update
            const updatedShips = localShips.map((ship) => {
                if (ship.id === shipId) {
                    // For the target ship, set all the new gear assignments
                    return {
                        ...ship,
                        equipment: gearAssignments.reduce(
                            (acc, { slot, gearId }) => ({ ...acc, [slot]: gearId }),
                            {}
                        ),
                    };
                }
                // For all other ships, remove any gear that's being equipped
                const equipment = { ...ship.equipment };
                gearAssignments.forEach(({ gearId }) => {
                    Object.entries(equipment).forEach(([key, value]) => {
                        if (value === gearId) {
                            equipment[key as GearSlotName] = undefined;
                        }
                    });
                });
                return {
                    ...ship,
                    equipment,
                };
            });
            setLocalShips(updatedShips);
            setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                // Delete existing equipment for all gear being equipped
                const gearIds = gearAssignments.map(({ gearId }) => gearId);
                const { error: deleteError } = await supabase
                    .from('ship_equipment')
                    .delete()
                    .in('gear_id', gearIds);

                if (deleteError) throw deleteError;

                // Update equipment in database
                const { error } = await supabase
                    .from('ship_equipment')
                    .upsert(
                        gearAssignments.map(({ slot, gearId }) => ({
                            ship_id: shipId,
                            slot,
                            gear_id: gearId,
                        }))
                    )
                    .eq('ship_id', shipId);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error equipping multiple gear:', error);
                addNotification('error', 'Failed to equip multiple gear');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );

    const removeGear = useCallback(
        async (shipId: string, slot: GearSlotName) => {
            // Optimistic update
            const updatedShips = localShips.map((ship) =>
                ship.id === shipId
                    ? {
                          ...ship,
                          equipment: {
                              ...ship.equipment,
                              [slot]: undefined,
                          },
                      }
                    : ship
            );
            setLocalShips(updatedShips);
            setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                // Remove equipment from database
                const { error } = await supabase
                    .from('ship_equipment')
                    .delete()
                    .eq('ship_id', shipId)
                    .eq('slot', slot);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error removing gear:', error);
                addNotification('error', 'Failed to remove gear');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );

    const lockEquipment = useCallback(
        async (shipId: string, locked: boolean) => {
            // Optimistic update
            const updatedShips = localShips.map((ship) =>
                ship.id === shipId
                    ? {
                          ...ship,
                          equipmentLocked: locked,
                      }
                    : ship
            );
            setLocalShips(updatedShips);
            setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                // Update lock state
                const { error } = await supabase
                    .from('ships')
                    .update({ equipment_locked: locked })
                    .eq('id', shipId)
                    .eq('user_id', user.id);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error updating equipment lock:', error);
                addNotification('error', 'Failed to update equipment lock');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );

    const validateGearAssignments = useCallback(() => {
        // This function is used to validate gear assignments across ships
        // It's called when gear is moved between ships to ensure no conflicts
        const gearAssignments = new Map<string, string>(); // gearId -> shipId
        const updatedShips = [...localShips];

        // First pass: collect all gear assignments
        updatedShips.forEach((ship) => {
            Object.entries(ship.equipment).forEach(([_, gearId]) => {
                if (gearId) {
                    gearAssignments.set(gearId, ship.id);
                }
            });
        });

        // Second pass: validate and fix conflicts
        updatedShips.forEach((ship) => {
            Object.entries(ship.equipment).forEach(([slot, gearId]) => {
                if (gearId) {
                    const assignedShipId = gearAssignments.get(gearId);
                    if (assignedShipId && assignedShipId !== ship.id) {
                        // Remove conflicting gear
                        ship.equipment[slot as GearSlotName] = undefined;
                    }
                }
            });
        });

        setLocalShips(updatedShips);
        setStorageShips(updatedShips);
    }, [localShips, setStorageShips]);

    const unequipAllEquipment = useCallback(
        async (shipId: string) => {
            // Optimistic update
            const updatedShips = localShips.map((ship) =>
                ship.id === shipId
                    ? {
                          ...ship,
                          equipment: {},
                      }
                    : ship
            );
            setLocalShips(updatedShips);
            setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                // Remove all equipment from database
                const { error } = await supabase
                    .from('ship_equipment')
                    .delete()
                    .eq('ship_id', shipId);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error removing all equipment:', error);
                addNotification('error', 'Failed to remove all equipment');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );

    const toggleEquipmentLock = useCallback(
        async (shipId: string) => {
            const ship = localShips.find((s) => s.id === shipId);
            if (!ship) throw new Error('Ship not found');
            await lockEquipment(shipId, !ship.equipmentLocked);
        },
        [localShips, lockEquipment]
    );

    const getShipFromGearId = useCallback(
        (gearId: string) => {
            const shipId = gearToShipMap.get(gearId);
            return shipId ? localShips.find((s) => s.id === shipId) : undefined;
        },
        [localShips, gearToShipMap]
    );

    return (
        <ShipsContext.Provider
            value={{
                ships: localShips,
                loading,
                error,
                editingShip,
                setEditingShip,
                getShipName,
                getShipById,
                addShip,
                updateShip,
                deleteShip,
                equipGear,
                equipMultipleGear,
                removeGear,
                lockEquipment,
                toggleEquipmentLock,
                validateGearAssignments,
                unequipAllEquipment,
                getShipFromGearId,
                gearToShipMap,
                setData: setStorageShips,
                loadShips,
            }}
        >
            {children}
        </ShipsContext.Provider>
    );
};

export const useShips = () => {
    const context = useContext(ShipsContext);
    if (context === undefined) {
        throw new Error('useShips must be used within a ShipsProvider');
    }
    return context;
};
