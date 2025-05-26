import { useCallback, useState, useEffect } from 'react';
import { Loadout, TeamLoadout } from '../types/loadout';
import { GearSlotName } from '../constants';
import { useNotification } from './useNotification';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthProvider';
import { useStorage } from './useStorage';
import { StorageKey } from '../constants/storage';
import { v4 as uuidv4 } from 'uuid';

interface RawLoadoutEquipment {
    slot: GearSlotName;
    gear_id: string;
}

interface RawLoadout {
    id: string;
    user_id: string;
    name: string;
    ship_id: string;
    created_at: string;
    updated_at: string;
    loadout_equipment: RawLoadoutEquipment[];
}

interface RawTeamLoadoutShip {
    position: number;
    ship_id: string;
}

interface RawTeamLoadoutEquipment {
    position: number;
    slot: GearSlotName;
    gear_id: string;
    ship_id: string;
}

interface RawTeamLoadout {
    id: string;
    user_id: string;
    name: string;
    created_at: string;
    updated_at: string;
    team_loadout_ships: RawTeamLoadoutShip[];
    team_loadout_equipment: RawTeamLoadoutEquipment[];
}

const transformLoadout = (data: RawLoadout): Loadout => {
    return {
        id: data.id,
        name: data.name,
        shipId: data.ship_id,
        equipment: data.loadout_equipment.reduce(
            (acc, eq) => {
                acc[eq.slot] = eq.gear_id;
                return acc;
            },
            {} as Record<GearSlotName, string>
        ),
        createdAt: new Date(data.created_at).getTime(),
    };
};

const transformTeamLoadout = (data: RawTeamLoadout): TeamLoadout => {
    return {
        id: data.id,
        name: data.name,
        shipLoadouts: data.team_loadout_ships.map((ship) => ({
            position: ship.position,
            shipId: ship.ship_id,
            equipment: data.team_loadout_equipment
                .filter((eq) => eq.ship_id === ship.ship_id)
                .reduce(
                    (acc, eq) => {
                        acc[eq.slot] = eq.gear_id;
                        return acc;
                    },
                    {} as Record<GearSlotName, string>
                ),
        })),
        createdAt: new Date(data.created_at).getTime(),
    };
};

export const useLoadouts = () => {
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);

    // Use useStorage for loadouts
    const { data: loadouts, setData: setLoadouts } = useStorage<Loadout[]>({
        key: StorageKey.LOADOUTS,
        defaultValue: [],
    });

    // Use useStorage for team loadouts
    const { data: teamLoadouts, setData: setTeamLoadouts } = useStorage<TeamLoadout[]>({
        key: StorageKey.TEAM_LOADOUTS,
        defaultValue: [],
    });

    const loadLoadouts = useCallback(async () => {
        try {
            setLoading(true);

            if (user?.id) {
                const { data: loadoutData, error: loadoutError } = await supabase
                    .from('loadouts')
                    .select(
                        `
                    *,
                    loadout_equipment (*)
                `
                    )
                    .eq('user_id', user.id);

                if (loadoutError) throw loadoutError;

                const { data: teamLoadoutData, error: teamLoadoutError } = await supabase
                    .from('team_loadouts')
                    .select(
                        `
                    *,
                    team_loadout_ships (*),
                    team_loadout_equipment (*)
                `
                    )
                    .eq('user_id', user.id);

                if (teamLoadoutError) throw teamLoadoutError;

                // Update both Supabase and localStorage through useStorage
                setLoadouts(loadoutData.map(transformLoadout));
                setTeamLoadouts(teamLoadoutData.map(transformTeamLoadout));
            }
        } catch (error) {
            console.error('Error loading loadouts:', error);
            addNotification('error', 'Failed to load loadouts');
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification, setLoadouts, setTeamLoadouts]);

    useEffect(() => {
        loadLoadouts();
    }, [loadLoadouts]);

    const addLoadout = useCallback(
        async (loadout: Omit<Loadout, 'id' | 'createdAt'>) => {
            const timestamp = Date.now();

            // Create a new loadout with a temporary ID for optimistic UI updates
            const newLoadout: Loadout = {
                id: uuidv4(),
                name: loadout.name,
                shipId: loadout.shipId,
                equipment: { ...loadout.equipment },
                createdAt: timestamp,
            };

            // Optimistically update UI
            setLoadouts((prev) => [...prev, newLoadout]);

            // If user is not authenticated, we're done (data is already saved to localStorage)
            if (!user?.id) {
                addNotification('success', 'Loadout added');
                return newLoadout.id;
            }

            // Otherwise, sync with Supabase
            try {
                // Create loadout record
                const { data: loadoutData, error: loadoutError } = await supabase
                    .from('loadouts')
                    .insert({
                        user_id: user.id,
                        name: loadout.name,
                        ship_id: loadout.shipId,
                    })
                    .select()
                    .single();

                if (loadoutError) throw loadoutError;

                // Create equipment records
                const equipmentRecords = Object.entries(loadout.equipment).map(
                    ([slot, gearId]) => ({
                        loadout_id: loadoutData.id,
                        slot,
                        gear_id: gearId,
                    })
                );

                const { error: equipmentError } = await supabase
                    .from('loadout_equipment')
                    .insert(equipmentRecords);

                if (equipmentError) throw equipmentError;

                // Update local state with the server-generated ID
                setLoadouts((prev) =>
                    prev.map((item) =>
                        item.id === newLoadout.id
                            ? {
                                  ...item,
                                  id: loadoutData.id,
                                  createdAt: new Date(loadoutData.created_at).getTime(),
                              }
                            : item
                    )
                );

                addNotification('success', 'Loadout added');
                return loadoutData.id; // Return the server-generated ID
            } catch (error) {
                console.error('Error adding loadout:', error);
                // Revert optimistic update
                setLoadouts((prev) => prev.filter((item) => item.id !== newLoadout.id));
                addNotification('error', 'Failed to add loadout');
                throw error;
            }
        },
        [user?.id, addNotification, setLoadouts]
    );

    const updateLoadout = useCallback(
        async (id: string, equipment: Record<GearSlotName, string>) => {
            // Create backup of current state for potential rollback
            const originalLoadouts = [...loadouts];

            // Optimistically update UI
            setLoadouts((prev) =>
                prev.map((loadout) =>
                    loadout.id === id ? { ...loadout, equipment: { ...equipment } } : loadout
                )
            );

            // If user is not authenticated, we're done (data already saved to localStorage)
            if (!user?.id) {
                addNotification('success', 'Loadout updated');
                return;
            }

            // Otherwise, sync with Supabase
            try {
                // Delete existing equipment
                const { error: deleteError } = await supabase
                    .from('loadout_equipment')
                    .delete()
                    .eq('loadout_id', id);

                if (deleteError) throw deleteError;

                // Insert new equipment
                const equipmentRecords = Object.entries(equipment).map(([slot, gearId]) => ({
                    loadout_id: id,
                    slot,
                    gear_id: gearId,
                }));

                const { error: insertError } = await supabase
                    .from('loadout_equipment')
                    .insert(equipmentRecords);

                if (insertError) throw insertError;

                addNotification('success', 'Loadout updated');
            } catch (error) {
                console.error('Error updating loadout:', error);
                // Revert optimistic update
                setLoadouts(originalLoadouts);
                addNotification('error', 'Failed to update loadout');
                throw error;
            }
        },
        [user?.id, loadouts, addNotification, setLoadouts]
    );

    const deleteLoadout = useCallback(
        async (id: string) => {
            // Create backup of current state for potential rollback
            const originalLoadouts = [...loadouts];

            // Optimistically update UI
            setLoadouts((prev) => prev.filter((loadout) => loadout.id !== id));

            // If user is not authenticated, we're done (data already saved to localStorage)
            if (!user?.id) {
                addNotification('success', 'Loadout deleted');
                return;
            }

            // Otherwise, sync with Supabase
            try {
                const { error } = await supabase
                    .from('loadouts')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (error) throw error;

                addNotification('success', 'Loadout deleted');
            } catch (error) {
                console.error('Error deleting loadout:', error);
                // Revert optimistic update
                setLoadouts(originalLoadouts);
                addNotification('error', 'Failed to delete loadout');
                throw error;
            }
        },
        [user?.id, loadouts, addNotification, setLoadouts]
    );

    const validateTeamLoadout = useCallback((shipLoadouts: TeamLoadout['shipLoadouts']) => {
        const usedGear = new Set<string>();

        for (const loadout of shipLoadouts) {
            for (const gearId of Object.values(loadout.equipment)) {
                if (usedGear.has(gearId)) {
                    return false;
                }
                usedGear.add(gearId);
            }
        }

        return true;
    }, []);

    const addTeamLoadout = useCallback(
        async (teamLoadout: Omit<TeamLoadout, 'id' | 'createdAt'>) => {
            if (!validateTeamLoadout(teamLoadout.shipLoadouts)) {
                throw new Error('Invalid team loadout: Duplicate gear pieces detected');
            }

            const timestamp = Date.now();

            // Create a new team loadout with a temporary ID for optimistic UI updates
            const newTeamLoadout: TeamLoadout = {
                id: uuidv4(),
                name: teamLoadout.name,
                shipLoadouts: [...teamLoadout.shipLoadouts],
                createdAt: timestamp,
            };

            // Optimistically update UI
            setTeamLoadouts((prev) => [...prev, newTeamLoadout]);

            // If user is not authenticated, we're done (data already saved to localStorage)
            if (!user?.id) {
                addNotification('success', 'Team loadout added');
                return newTeamLoadout.id;
            }

            // Otherwise, sync with Supabase
            try {
                // Create team loadout record
                const { data: teamLoadoutData, error: teamLoadoutError } = await supabase
                    .from('team_loadouts')
                    .insert({
                        user_id: user.id,
                        name: teamLoadout.name,
                    })
                    .select()
                    .single();

                if (teamLoadoutError) throw teamLoadoutError;

                // Create ship records
                const shipRecords = teamLoadout.shipLoadouts.map((loadout, index) => ({
                    team_loadout_id: teamLoadoutData.id,
                    position: index,
                    ship_id: loadout.shipId,
                }));

                const { error: shipError } = await supabase
                    .from('team_loadout_ships')
                    .insert(shipRecords);

                if (shipError) throw shipError;

                // Create equipment records
                const equipmentRecords = teamLoadout.shipLoadouts.flatMap((loadout, position) =>
                    Object.entries(loadout.equipment).map(([slot, gearId]) => ({
                        team_loadout_id: teamLoadoutData.id,
                        position,
                        slot,
                        gear_id: gearId,
                    }))
                );

                const { error: equipmentError } = await supabase
                    .from('team_loadout_equipment')
                    .insert(equipmentRecords);

                if (equipmentError) throw equipmentError;

                // Update local state with the server-generated ID
                setTeamLoadouts((prev) =>
                    prev.map((item) =>
                        item.id === newTeamLoadout.id
                            ? {
                                  ...item,
                                  id: teamLoadoutData.id,
                                  createdAt: new Date(teamLoadoutData.created_at).getTime(),
                              }
                            : item
                    )
                );

                addNotification('success', 'Team loadout added');
                return teamLoadoutData.id; // Return the server-generated ID
            } catch (error) {
                console.error('Error adding team loadout:', error);
                // Revert optimistic update
                setTeamLoadouts((prev) => prev.filter((item) => item.id !== newTeamLoadout.id));
                addNotification('error', 'Failed to add team loadout');
                throw error;
            }
        },
        [user?.id, addNotification, setTeamLoadouts, validateTeamLoadout]
    );

    const updateTeamLoadout = useCallback(
        async (id: string, shipLoadouts: TeamLoadout['shipLoadouts']) => {
            if (!validateTeamLoadout(shipLoadouts)) {
                throw new Error('Invalid team loadout: Duplicate gear pieces detected');
            }

            // Create backup of current state for potential rollback
            const originalTeamLoadouts = [...teamLoadouts];

            // Optimistically update UI
            setTeamLoadouts((prev) =>
                prev.map((teamLoadout) =>
                    teamLoadout.id === id
                        ? { ...teamLoadout, shipLoadouts: [...shipLoadouts] }
                        : teamLoadout
                )
            );

            // If user is not authenticated, we're done (data already saved to localStorage)
            if (!user?.id) {
                addNotification('success', 'Team loadout updated');
                return;
            }

            // Otherwise, sync with Supabase
            try {
                // Delete existing records
                const { error: deleteShipsError } = await supabase
                    .from('team_loadout_ships')
                    .delete()
                    .eq('team_loadout_id', id);

                if (deleteShipsError) throw deleteShipsError;

                const { error: deleteEquipmentError } = await supabase
                    .from('team_loadout_equipment')
                    .delete()
                    .eq('team_loadout_id', id);

                if (deleteEquipmentError) throw deleteEquipmentError;

                // Create new ship records
                const shipRecords = shipLoadouts.map((loadout, index) => ({
                    team_loadout_id: id,
                    position: index,
                    ship_id: loadout.shipId,
                }));

                const { error: shipError } = await supabase
                    .from('team_loadout_ships')
                    .insert(shipRecords);

                if (shipError) throw shipError;

                // Create new equipment records
                const equipmentRecords = shipLoadouts.flatMap((loadout, position) =>
                    Object.entries(loadout.equipment).map(([slot, gearId]) => ({
                        team_loadout_id: id,
                        position,
                        slot,
                        gear_id: gearId,
                    }))
                );

                const { error: equipmentError } = await supabase
                    .from('team_loadout_equipment')
                    .insert(equipmentRecords);

                if (equipmentError) throw equipmentError;

                addNotification('success', 'Team loadout updated');
            } catch (error) {
                console.error('Error updating team loadout:', error);
                // Revert optimistic update
                setTeamLoadouts(originalTeamLoadouts);
                addNotification('error', 'Failed to update team loadout');
                throw error;
            }
        },
        [user?.id, teamLoadouts, addNotification, setTeamLoadouts, validateTeamLoadout]
    );

    const deleteTeamLoadout = useCallback(
        async (id: string) => {
            // Create backup of current state for potential rollback
            const originalTeamLoadouts = [...teamLoadouts];

            // Optimistically update UI
            setTeamLoadouts((prev) => prev.filter((teamLoadout) => teamLoadout.id !== id));

            // If user is not authenticated, we're done (data already saved to localStorage)
            if (!user?.id) {
                addNotification('success', 'Team loadout deleted');
                return;
            }

            // Otherwise, sync with Supabase
            try {
                const { error } = await supabase
                    .from('team_loadouts')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', user.id);

                if (error) throw error;

                addNotification('success', 'Team loadout deleted');
            } catch (error) {
                console.error('Error deleting team loadout:', error);
                // Revert optimistic update
                setTeamLoadouts(originalTeamLoadouts);
                addNotification('error', 'Failed to delete team loadout');
                throw error;
            }
        },
        [user?.id, teamLoadouts, addNotification, setTeamLoadouts]
    );

    return {
        loadouts,
        loading,
        addLoadout,
        updateLoadout,
        deleteLoadout,
        teamLoadouts,
        addTeamLoadout,
        updateTeamLoadout,
        deleteTeamLoadout,
    };
};
