import React, {
    createContext,
    useContext,
    useCallback,
    useState,
    useEffect,
    useMemo,
    useRef,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';
import {
    GearSlotName,
    ImplantSlotName,
    isGearSlotName,
    isImplantSlotName,
} from '../constants/gearTypes';
import { Ship } from '../types/ship';
import { normaliseShipFields } from '../utils/ship/normaliseShipFields';
import { fetchShips } from '../services/fleetReads';
import { useStorage } from '../hooks/useStorage';
import { StorageKey } from '../constants/storage';
import { isSupabaseSyncEnabled } from '../utils/syncUtils';
import { useActiveProfile, PROFILE_SWITCH_EVENT } from './ActiveProfileProvider';

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
    /** Equips gear and, optionally, implants onto one ship in a single ship write. The passed
     *  gear slots are merged over the ship's existing equipment — a slot left out of
     *  `gearAssignments` keeps whatever it already held, matching the DB path (which only
     *  deletes/upserts the slots it's given). Every assigned piece is taken off whichever other
     *  ship in the fleet wore it. Safe to call once per ship back-to-back without an intervening
     *  render (e.g. a team loadout's one call per ship): every writer in this context reads and
     *  writes through `localShipsRef`, so each call sees the previous call's result. */
    equipMultipleGear: (
        shipId: string,
        gearAssignments: { slot: GearSlotName; gearId: string }[],
        implantAssignments?: { slot: ImplantSlotName; gearId: string }[]
    ) => Promise<void>;
    removeGear: (shipId: string, slot: GearSlotName) => Promise<void>;
    equipImplant: (shipId: string, slot: ImplantSlotName, gearId: string) => Promise<void>;
    removeImplant: (shipId: string, slot: ImplantSlotName) => Promise<void>;
    lockEquipment: (shipId: string, locked: boolean) => Promise<void>;
    toggleEquipmentLock: (shipId: string) => Promise<void>;
    toggleStarred: (shipId: string) => Promise<void>;
    validateGearAssignments: () => void;
    unequipAllEquipment: (shipId: string) => Promise<void>;
    getShipFromGearId: (gearId: string) => Ship | undefined;
    gearToShipMap: Map<string, string>;
    setData: (data: Ship[] | ((prev: Ship[]) => Ship[])) => Promise<void>;
    loadShips: () => Promise<void>;
}

const ShipsContext = createContext<ShipsContextType | undefined>(undefined);

export const ShipsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingShip, setEditingShip] = useState<Ship | undefined>();
    const { addNotification } = useNotification();
    const { activeProfileId, profilesLoading } = useActiveProfile();
    const [isMigrating, setIsMigrating] = useState(false);
    const [localShips, setLocalShips] = useState<Ship[]>([]);
    // Every writer reads and writes the ships array through this ref instead of the `localShips`
    // render closure. Two writers called back-to-back with no render in between (e.g. one
    // `equipMultipleGear` call per ship in a team loadout) each hold the SAME closure, so a
    // second writer built from `localShips` would overwrite the first writer's result rather
    // than build on it (#560). The ref is updated synchronously by `setShips`, never in an
    // effect, so it is never a render behind.
    const localShipsRef = useRef<Ship[]>([]);

    const setShips = useCallback((next: Ship[]) => {
        localShipsRef.current = next;
        setLocalShips(next);
    }, []);

    // Use useStorage for ships
    const { data: storageShips, setData: setStorageShips } = useStorage<Ship[]>({
        key: StorageKey.SHIPS,
        defaultValue: [],
    });

    // `useStorage` casts parsed JSON straight to `Ship[]` with no runtime check — see
    // `normaliseShipFields` for what a stored ship can carry. Normalised on every read rather
    // than written back: it's idempotent, so nothing drifts by leaving storage as-is until a
    // writer (e.g. `commitShips`) persists the normalised value anyway (#568).
    const normalisedStorageShips = useMemo(
        () => storageShips.map(normaliseShipFields),
        [storageShips]
    );

    // A writer's full commit: local state, ref and persisted storage together, so no call site
    // can update one without the others.
    const commitShips = useCallback(
        (next: Ship[]) => {
            setShips(next);
            void setStorageShips(next);
        },
        [setShips, setStorageShips]
    );

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

    // Synchronize local state with storage, enriching skill text from templates for unauthenticated users
    useEffect(() => {
        if (!normalisedStorageShips) return;

        // Authenticated path: loadShips() handles enrichment via the ship_templates join
        if (activeProfileId) {
            setShips(normalisedStorageShips);
            return;
        }

        // Unauthenticated path: fetch skill text from ship_templates for ships that are missing it
        const shipsNeedingText = normalisedStorageShips.filter(
            (s) => !s.activeSkillText || !s.activeTarget
        );
        if (shipsNeedingText.length === 0) {
            setShips(normalisedStorageShips);
            return;
        }

        const controller = new AbortController();
        const uniqueNames = [...new Set(shipsNeedingText.map((s) => s.name))];
        void supabase
            .from('ship_templates')
            .select(
                'name, active_skill_text, charge_skill_text, charge_skill_charge, first_passive_skill_text, second_passive_skill_text, third_passive_skill_text, active_target, active_pattern, charged_target, charged_pattern'
            )
            .in('name', uniqueNames)
            .abortSignal(controller.signal)
            .then(({ data }) => {
                if (controller.signal.aborted) return;
                if (!data) {
                    setShips(normalisedStorageShips);
                    return;
                }
                const templateMap = new Map(data.map((t) => [t.name, t]));
                setShips(
                    normalisedStorageShips.map((ship) => {
                        // Outer filter casts a wide net (missing text OR targeting);
                        // skip only ships that already have both.
                        if (ship.activeSkillText && ship.activeTarget) return ship;
                        const t = templateMap.get(ship.name);
                        if (!t) return ship;
                        return {
                            ...ship,
                            activeSkillText: t.active_skill_text ?? ship.activeSkillText,
                            chargeSkillText: t.charge_skill_text ?? ship.chargeSkillText,
                            chargeSkillCharge: t.charge_skill_charge ?? ship.chargeSkillCharge,
                            firstPassiveSkillText:
                                t.first_passive_skill_text ?? ship.firstPassiveSkillText,
                            secondPassiveSkillText:
                                t.second_passive_skill_text ?? ship.secondPassiveSkillText,
                            thirdPassiveSkillText:
                                t.third_passive_skill_text ?? ship.thirdPassiveSkillText,
                            activeTarget: t.active_target ?? ship.activeTarget,
                            activePattern: t.active_pattern ?? ship.activePattern,
                            chargedTarget: t.charged_target ?? ship.chargedTarget,
                            chargedPattern: t.charged_pattern ?? ship.chargedPattern,
                        };
                    })
                );
            });

        return () => {
            controller.abort();
        };
    }, [normalisedStorageShips, activeProfileId, setShips]);

    const loadShips = useCallback(async () => {
        // Skip loading if we're in the middle of migration
        if (isMigrating) return;

        try {
            setLoading(true);
            if (activeProfileId) {
                const transformedShips = await fetchShips(supabase, activeProfileId);

                setShips(transformedShips);
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
    }, [activeProfileId, addNotification, setShips, setStorageShips, isMigrating]);

    // Initial load and reload on auth/profile changes
    useEffect(() => {
        if (activeProfileId !== null && !profilesLoading) {
            void loadShips();
        }
    }, [activeProfileId, profilesLoading, loadShips]);

    useEffect(() => {
        const handleSignOut = () => {
            // Only clear data if we're not in the middle of migration
            if (!isMigrating) {
                // Clear through useStorage so localStorage is wiped too —
                // otherwise a refresh re-hydrates the signed-out user's ships.
                void setStorageShips([]);
            }
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => {
            window.removeEventListener('app:signout', handleSignOut);
        };
    }, [setStorageShips, isMigrating]);

    // Reset in-memory ship state when the active profile changes.
    // The activeProfileId-keyed loadShips effect will refetch automatically.
    useEffect(() => {
        const onSwitch = () => {
            // Also clear storage so the storageShips→localShips sync effect doesn't
            // repopulate localShips with the previous profile's data before loadShips
            // fires for the new profile.
            commitShips([]);
        };
        window.addEventListener(PROFILE_SWITCH_EVENT, onSwitch);
        return () => window.removeEventListener(PROFILE_SWITCH_EVENT, onSwitch);
    }, [commitShips]);

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
                commitShips(updatedShips);
            }
        }
    }, [localShips, commitShips]);

    // Reads the ref, so a lookup issued right after a writer (no re-render yet) sees that
    // writer's result. `localShips` stays a dependency anyway: consumers memoize on these
    // lookups' identity, and a lookup that never changes identity leaves them holding the
    // result they computed against the list before ships loaded.
    const getShipName = useCallback(
        (id: string) => localShipsRef.current.find((ship) => ship.id === id)?.name,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- identity must follow localShips
        [localShips]
    );

    const getShipById = useCallback(
        (id: string) => localShipsRef.current.find((ship) => ship.id === id),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- identity must follow localShips
        [localShips]
    );

    const addShip = useCallback(
        async (newShip: Omit<Ship, 'id'>) => {
            const tempId = uuidv4();

            const optimisticShip: Ship = {
                ...newShip,
                id: tempId,
            };
            commitShips([...localShipsRef.current, optimisticShip]);

            if (!activeProfileId) return getShipById(tempId) as Ship;
            if (!isSupabaseSyncEnabled()) return getShipById(tempId) as Ship;

            try {
                // Create ship record
                const shipData = {
                    user_id: activeProfileId,
                    name: newShip.name,
                    type: newShip.type,
                    faction: newShip.faction,
                    rarity: newShip.rarity,
                    affinity: newShip.affinity,
                    equipment_locked: newShip.equipmentLocked,
                    starred: newShip.starred,
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

                return getShipById(insertedShip.id as string) as Ship;
            } catch (error) {
                // Revert optimistic update on error
                commitShips(localShipsRef.current.filter((s) => s.id !== tempId));
                console.error('Error adding ship:', error);
                addNotification('error', 'Failed to add ship');
                throw error;
            }
        },
        [activeProfileId, getShipById, addNotification, commitShips]
    );

    const updateShip = useCallback(
        async (id: string, updates: Partial<Ship>) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) =>
                ship.id === id ? { ...ship, ...updates } : ship
            );
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

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
                        starred: updates.starred,
                    })
                    .eq('id', id)
                    .eq('user_id', activeProfileId);

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
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const deleteShip = useCallback(
        async (id: string) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.filter((ship) => ship.id !== id);
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

            try {
                // Delete ship record (this will cascade delete related records)
                const { error } = await supabase
                    .from('ships')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', activeProfileId);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error deleting ship:', error);
                addNotification('error', 'Failed to delete ship');
                throw error;
            }
        },
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const equipGear = useCallback(
        async (shipId: string, slot: GearSlotName, gearId: string) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) => {
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
                    if (value === gearId && isGearSlotName(key)) {
                        equipment[key] = undefined;
                    }
                });
                return {
                    ...ship,
                    equipment,
                };
            });
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

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
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const equipMultipleGear = useCallback(
        async (
            shipId: string,
            gearAssignments: { slot: GearSlotName; gearId: string }[],
            implantAssignments: { slot: ImplantSlotName; gearId: string }[] = []
        ) => {
            const implantIds = implantAssignments.map(({ gearId }) => gearId);
            let targetImplants: Partial<Record<ImplantSlotName, string>> = {};

            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) => {
                if (ship.id === shipId) {
                    // For the target ship, set all the new gear assignments and merge the
                    // assigned implants over the ones it already wears
                    targetImplants = implantAssignments.reduce(
                        (acc, { slot, gearId }) => ({ ...acc, [slot]: gearId }),
                        { ...ship.implants }
                    );
                    // Merged over the ship's existing equipment, so a slot left out of
                    // gearAssignments (or an implants-only write, where it's empty) keeps
                    // whatever it already held — matching the DB path below, which only
                    // deletes/upserts the slots it's given. An assigned piece leaves any other
                    // slot it held here, as the DB's delete-by-gear_id does.
                    const assignedGearIds = new Set(gearAssignments.map(({ gearId }) => gearId));
                    const keptEquipment = { ...ship.equipment };
                    Object.entries(keptEquipment).forEach(([key, value]) => {
                        if (value && assignedGearIds.has(value) && isGearSlotName(key)) {
                            keptEquipment[key] = undefined;
                        }
                    });
                    return {
                        ...ship,
                        equipment: gearAssignments.reduce(
                            (acc, { slot, gearId }) => ({ ...acc, [slot]: gearId }),
                            keptEquipment
                        ),
                        implants: targetImplants,
                    };
                }
                // For all other ships, remove any gear or implant that's being equipped
                const equipment = { ...ship.equipment };
                gearAssignments.forEach(({ gearId }) => {
                    Object.entries(equipment).forEach(([key, value]) => {
                        if (value === gearId && isGearSlotName(key)) {
                            equipment[key] = undefined;
                        }
                    });
                });
                const implants = { ...ship.implants };
                Object.entries(implants).forEach(([key, value]) => {
                    if (value && implantIds.includes(value) && isImplantSlotName(key)) {
                        delete implants[key];
                    }
                });
                return {
                    ...ship,
                    equipment,
                    implants,
                };
            });
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

            try {
                if (implantIds.length > 0) {
                    // `ship_implants.id` is the implant's own id, so a donor's row must go before
                    // the target can insert it; the target's own rows are cleared too, or a
                    // replaced implant stays in its slot.
                    const { error: donorError } = await supabase
                        .from('ship_implants')
                        .delete()
                        .in('id', implantIds);
                    if (donorError) throw donorError;

                    const { error: clearError } = await supabase
                        .from('ship_implants')
                        .delete()
                        .eq('ship_id', shipId);
                    if (clearError) throw clearError;

                    const implantRows = Object.entries(targetImplants)
                        .filter(([, gearId]) => gearId)
                        .map(([slot, gearId]) => ({ ship_id: shipId, slot, id: gearId }));
                    if (implantRows.length > 0) {
                        const { error: insertError } = await supabase
                            .from('ship_implants')
                            .insert(implantRows);
                        if (insertError) throw insertError;
                    }
                }

                if (gearAssignments.length === 0) return;

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
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const removeGear = useCallback(
        async (shipId: string, slot: GearSlotName) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) =>
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
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

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
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const equipImplant = useCallback(
        async (shipId: string, slot: ImplantSlotName, gearId: string) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) =>
                ship.id === shipId
                    ? {
                          ...ship,
                          implants: {
                              ...ship.implants,
                              [slot]: gearId,
                          },
                      }
                    : ship
            );
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

            try {
                // Delete existing implant in this slot for this ship
                const { error: deleteError } = await supabase
                    .from('ship_implants')
                    .delete()
                    .eq('ship_id', shipId)
                    .eq('slot', slot);

                if (deleteError) throw deleteError;

                // Insert new implant
                const { error: insertError } = await supabase.from('ship_implants').insert({
                    ship_id: shipId,
                    slot,
                    id: gearId,
                });

                if (insertError) throw insertError;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error equipping implant:', error);
                addNotification('error', 'Failed to equip implant');
                throw error;
            }
        },
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const removeImplant = useCallback(
        async (shipId: string, slot: ImplantSlotName) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) => {
                if (ship.id === shipId) {
                    const implants = { ...ship.implants };
                    delete implants[slot];
                    return {
                        ...ship,
                        implants,
                    };
                }
                return ship;
            });
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

            try {
                // Remove implant from database
                const { error } = await supabase
                    .from('ship_implants')
                    .delete()
                    .eq('ship_id', shipId)
                    .eq('slot', slot);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error removing implant:', error);
                addNotification('error', 'Failed to remove implant');
                throw error;
            }
        },
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const lockEquipment = useCallback(
        async (shipId: string, locked: boolean) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) =>
                ship.id === shipId
                    ? {
                          ...ship,
                          equipmentLocked: locked,
                      }
                    : ship
            );
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

            try {
                // Update lock state
                const { error } = await supabase
                    .from('ships')
                    .update({ equipment_locked: locked })
                    .eq('id', shipId)
                    .eq('user_id', activeProfileId);

                if (error) throw error;
            } catch (error) {
                // Revert optimistic update on error
                await loadShips();
                console.error('Error updating equipment lock:', error);
                addNotification('error', 'Failed to update equipment lock');
                throw error;
            }
        },
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const validateGearAssignments = useCallback(() => {
        // This function is used to validate gear assignments across ships
        // It's called when gear is moved between ships to ensure no conflicts
        const gearAssignments = new Map<string, string>(); // gearId -> shipId
        const updatedShips = [...localShipsRef.current];

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
                if (gearId && isGearSlotName(slot)) {
                    const assignedShipId = gearAssignments.get(gearId);
                    if (assignedShipId && assignedShipId !== ship.id) {
                        // Remove conflicting gear
                        ship.equipment[slot] = undefined;
                    }
                }
            });
        });

        commitShips(updatedShips);
    }, [commitShips]);

    const unequipAllEquipment = useCallback(
        async (shipId: string) => {
            // Optimistic update
            const updatedShips = localShipsRef.current.map((ship) =>
                ship.id === shipId
                    ? {
                          ...ship,
                          equipment: {},
                      }
                    : ship
            );
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

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
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const toggleEquipmentLock = useCallback(
        async (shipId: string) => {
            const ship = localShipsRef.current.find((s) => s.id === shipId);
            if (!ship) throw new Error('Ship not found');
            await lockEquipment(shipId, !ship.equipmentLocked);
        },
        [lockEquipment]
    );

    const toggleStarred = useCallback(
        async (shipId: string) => {
            const ship = localShipsRef.current.find((s) => s.id === shipId);
            if (!ship) throw new Error('Ship not found');

            const newStarred = !ship.starred;

            // Optimistic update
            const updatedShips = localShipsRef.current.map((s) =>
                s.id === shipId ? { ...s, starred: newStarred } : s
            );
            commitShips(updatedShips);

            if (!activeProfileId) return;
            if (!isSupabaseSyncEnabled()) return;

            try {
                const { error } = await supabase
                    .from('ships')
                    .update({ starred: newStarred })
                    .eq('id', shipId)
                    .eq('user_id', activeProfileId);

                if (error) throw error;
            } catch (error) {
                await loadShips();
                console.error('Error updating starred state:', error);
                addNotification('error', 'Failed to update starred state');
                throw error;
            }
        },
        [activeProfileId, loadShips, addNotification, commitShips]
    );

    const getShipFromGearId = useCallback(
        (gearId: string) => {
            const shipId = gearToShipMap.get(gearId);
            return shipId ? localShipsRef.current.find((s) => s.id === shipId) : undefined;
        },
        [gearToShipMap]
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
                equipImplant,
                removeImplant,
                lockEquipment,
                toggleEquipmentLock,
                toggleStarred,
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
