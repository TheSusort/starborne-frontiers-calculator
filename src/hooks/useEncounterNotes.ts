import { useCallback, useState, useEffect } from 'react';
import {
    LocalEncounterNote,
    ShipPosition,
    Position,
    SharedShipPosition,
} from '../types/encounters';
import { useNotification } from './useNotification';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthProvider';
import { useShips } from '../contexts/ShipsContext';
import { useStorage } from './useStorage';
import { StorageKey } from '../constants/storage';
import { v4 as uuidv4 } from 'uuid';

interface RawEncounterFormation {
    note_id: string;
    position: string;
    ship_id: string;
}

interface RawEncounterNote {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    is_public: boolean;
    created_at: string;
    updated_at: string;
    encounter_formations: RawEncounterFormation[];
}

const transformEncounterNote = (data: RawEncounterNote): LocalEncounterNote => {
    return {
        id: data.id,
        name: data.name,
        description: data.description || '',
        isPublic: data.is_public,
        formation: data.encounter_formations.map((f) => ({
            shipId: f.ship_id,
            position: f.position as Position,
        })),
        createdAt: new Date(data.created_at).getTime(),
    };
};

export const useEncounterNotes = () => {
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const { ships } = useShips();
    const [loading, setLoading] = useState(true);

    // Use useStorage for encounters
    const { data: encounters, setData: setEncounters } = useStorage<LocalEncounterNote[]>({
        key: StorageKey.ENCOUNTERS,
        defaultValue: [],
    });

    const loadEncounters = useCallback(async () => {
        try {
            setLoading(true);
            if (user?.id) {
                const { data, error } = await supabase
                    .from('encounter_notes')
                    .select(
                        `
                    *,
                    encounter_formations (*)
                `
                    )
                    .eq('user_id', user.id);

                if (error) throw error;

                const transformedEncounters = data.map(transformEncounterNote);
                setEncounters(transformedEncounters);
            }
        } catch (error) {
            console.error('Error loading encounters:', error);
            addNotification('error', 'Failed to load encounters');
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification, setEncounters]);

    // Initial load and reload on auth changes
    useEffect(() => {
        loadEncounters();
    }, [loadEncounters]);

    // Ensure encounter formations are properly initialized
    useEffect(() => {
        if (encounters.length > 0) {
            const updatedEncounters = encounters.map((encounter) => ({
                ...encounter,
                formation: encounter.formation || [],
            }));

            if (JSON.stringify(updatedEncounters) !== JSON.stringify(encounters)) {
                setEncounters(updatedEncounters);
            }
        }
    }, [encounters, setEncounters]);

    const addEncounter = useCallback(
        async (encounter: Omit<LocalEncounterNote, 'id' | 'createdAt'>) => {
            const tempId = `encounter-${uuidv4()}`;
            const now = Date.now();

            // Create optimistic encounter
            const optimisticEncounter: LocalEncounterNote = {
                ...encounter,
                id: tempId,
                createdAt: now,
                formation: encounter.formation || [],
            };

            // Optimistic update
            setEncounters((prev) => [...prev, optimisticEncounter]);

            if (!user?.id) return optimisticEncounter;

            try {
                // Create encounter note
                const { data: noteData, error: noteError } = await supabase
                    .from('encounter_notes')
                    .insert({
                        user_id: user.id,
                        name: encounter.name,
                        description: encounter.description,
                        is_public: encounter.isPublic,
                    })
                    .select()
                    .single();

                if (noteError) throw noteError;

                // Create formation records
                const formationRecords = encounter.formation.map(
                    (pos: ShipPosition | SharedShipPosition) => {
                        if ('shipId' in pos) {
                            return {
                                note_id: noteData.id,
                                position: pos.position,
                                ship_id: pos.shipId,
                            };
                        } else {
                            const ship = ships.find((s) => s.name === pos.shipName);
                            if (!ship) {
                                throw new Error(`Ship with name ${pos.shipName} not found`);
                            }
                            return {
                                note_id: noteData.id,
                                position: pos.position,
                                ship_id: ship.id,
                            };
                        }
                    }
                );

                const { error: formationError } = await supabase
                    .from('encounter_formations')
                    .insert(formationRecords);

                if (formationError) throw formationError;

                await loadEncounters();
                addNotification('success', 'Encounter added successfully');
                return transformEncounterNote(noteData as RawEncounterNote);
            } catch (error) {
                // Revert optimistic update on error
                setEncounters((prev) => prev.filter((e) => e.id !== tempId));
                console.error('Error adding encounter:', error);
                addNotification('error', 'Failed to add encounter');
                throw error;
            }
        },
        [user?.id, loadEncounters, addNotification, ships, setEncounters]
    );

    const updateEncounter = useCallback(
        async (encounter: LocalEncounterNote) => {
            // Create updated encounter with ensured formation
            const updatedEncounter = {
                ...encounter,
                formation: encounter.formation || [],
            };

            // Optimistic update
            setEncounters((prev) =>
                prev.map((e) => (e.id === encounter.id ? updatedEncounter : e))
            );

            if (!user?.id) return;

            try {
                // Update encounter note
                const { error: noteError } = await supabase
                    .from('encounter_notes')
                    .update({
                        name: encounter.name,
                        description: encounter.description,
                        is_public: encounter.isPublic,
                    })
                    .eq('id', encounter.id)
                    .eq('user_id', user.id);

                if (noteError) throw noteError;

                // Delete existing formations
                const { error: deleteError } = await supabase
                    .from('encounter_formations')
                    .delete()
                    .eq('note_id', encounter.id);

                if (deleteError) throw deleteError;

                // Create new formation records
                const formationRecords = encounter.formation.map((pos: ShipPosition) => {
                    return {
                        note_id: encounter.id,
                        position: pos.position,
                        ship_id: pos.shipId,
                    };
                });

                const { error: formationError } = await supabase
                    .from('encounter_formations')
                    .insert(formationRecords);

                if (formationError) throw formationError;

                await loadEncounters();
                addNotification('success', 'Encounter updated successfully');
            } catch (error) {
                // Revert optimistic update on error
                await loadEncounters();
                console.error('Error updating encounter:', error);
                addNotification('error', 'Failed to update encounter');
                throw error;
            }
        },
        [user?.id, loadEncounters, addNotification, setEncounters]
    );

    const deleteEncounter = useCallback(
        async (encounterId: string) => {
            // Optimistic update
            setEncounters((prev) => prev.filter((e) => e.id !== encounterId));

            if (!user?.id) return;

            try {
                const { error } = await supabase
                    .from('encounter_notes')
                    .delete()
                    .eq('id', encounterId)
                    .eq('user_id', user.id);

                if (error) throw error;

                // We don't need to reload here as the optimistic update already removed it
                addNotification('success', 'Encounter deleted successfully');
            } catch (error) {
                // Revert optimistic update on error
                await loadEncounters();
                console.error('Error deleting encounter:', error);
                addNotification('error', 'Failed to delete encounter');
                throw error;
            }
        },
        [user?.id, loadEncounters, addNotification, setEncounters]
    );

    return {
        encounters,
        loading,
        addEncounter,
        updateEncounter,
        deleteEncounter,
    };
};
