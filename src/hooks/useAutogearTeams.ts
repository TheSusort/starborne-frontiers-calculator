import { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AutogearTeam } from '../types/autogearTeam';
import { supabase } from '../config/supabase';
import { useActiveProfile, PROFILE_SWITCH_EVENT } from '../contexts/ActiveProfileProvider';
import { StorageKey } from '../constants/storage';
import { isSupabaseSyncEnabled } from '../utils/syncUtils';
import { useStorage } from './useStorage';
import { useNotification } from './useNotification';

interface RawAutogearTeam {
    id: string;
    name: string;
    ship_ids: string[];
    created_at: string;
}

const transformTeam = (data: RawAutogearTeam): AutogearTeam => ({
    id: data.id,
    name: data.name,
    shipIds: Array.isArray(data.ship_ids) ? data.ship_ids : [],
    createdAt: new Date(data.created_at).getTime(),
});

/**
 * Saved Autogear teams: localStorage for everyone, Supabase for signed-in
 * profiles. Mirrors the dual-storage shape of useLoadouts.
 *
 * Only ONE instance of this hook should be live at a time (the Autogear page
 * owns it and passes the data down). Two instances would hold two independent
 * useStorage states over the same key and would not see each other's writes.
 */
export const useAutogearTeams = () => {
    const { addNotification } = useNotification();
    const { activeProfileId, profilesLoading } = useActiveProfile();
    const [loading, setLoading] = useState(false);
    const [isMigrating, setIsMigrating] = useState(false);

    const { data: teams, setData: setTeams } = useStorage<AutogearTeam[]>({
        key: StorageKey.AUTOGEAR_TEAMS,
        defaultValue: [],
    });

    const loadTeams = useCallback(async () => {
        if (isMigrating) return;
        if (!activeProfileId) return;
        if (!isSupabaseSyncEnabled()) return;

        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('autogear_teams')
                .select('*')
                .eq('user_id', activeProfileId)
                .order('created_at', { ascending: true });

            if (error) throw error;

            if (data) {
                void setTeams((data as RawAutogearTeam[]).map(transformTeam));
            }
        } catch (error) {
            console.error('Error loading autogear teams:', error);
            addNotification('error', 'Failed to load saved teams');
        } finally {
            setLoading(false);
        }
    }, [activeProfileId, addNotification, setTeams, isMigrating]);

    useEffect(() => {
        if (activeProfileId !== null && !profilesLoading) {
            void loadTeams();
        }
    }, [activeProfileId, profilesLoading, loadTeams]);

    // Clear on sign-out, but never mid-migration (that would drop data we are
    // in the middle of pushing to Supabase).
    useEffect(() => {
        const handleSignOut = () => {
            if (!isMigrating) {
                void setTeams([]);
            }
        };

        window.addEventListener('app:signout', handleSignOut);
        return () => window.removeEventListener('app:signout', handleSignOut);
    }, [setTeams, isMigrating]);

    // Drop the previous profile's teams before the new profile's load lands.
    useEffect(() => {
        const onSwitch = () => {
            void setTeams([]);
        };

        window.addEventListener(PROFILE_SWITCH_EVENT, onSwitch);
        return () => window.removeEventListener(PROFILE_SWITCH_EVENT, onSwitch);
    }, [setTeams]);

    useEffect(() => {
        const handleMigrationStart = () => setIsMigrating(true);
        const handleMigrationEnd = () => setIsMigrating(false);

        window.addEventListener('app:migration:start', handleMigrationStart);
        window.addEventListener('app:migration:end', handleMigrationEnd);

        return () => {
            window.removeEventListener('app:migration:start', handleMigrationStart);
            window.removeEventListener('app:migration:end', handleMigrationEnd);
        };
    }, []);

    const saveTeam = useCallback(
        async (name: string, shipIds: string[]): Promise<string> => {
            const newTeam: AutogearTeam = {
                id: uuidv4(),
                name,
                shipIds,
                createdAt: Date.now(),
            };

            void setTeams((prev) => [...prev, newTeam]); // Optimistic update

            if (!activeProfileId || !isSupabaseSyncEnabled()) {
                addNotification('success', `Team "${name}" saved`);
                return newTeam.id;
            }

            try {
                const { data, error } = await supabase
                    .from('autogear_teams')
                    .insert({
                        user_id: activeProfileId,
                        name,
                        ship_ids: shipIds,
                    })
                    .select()
                    .single();

                if (error) throw error;

                // Adopt the server-generated id so a later delete or order
                // update targets the right row.
                const savedTeam = transformTeam(data as RawAutogearTeam);
                void setTeams((prev) =>
                    prev.map((team) => (team.id === newTeam.id ? savedTeam : team))
                );
                addNotification('success', `Team "${name}" saved`);
                return savedTeam.id;
            } catch (error) {
                console.error('Error saving autogear team:', error);
                void setTeams((prev) => prev.filter((team) => team.id !== newTeam.id)); // Revert optimistic update
                addNotification('error', 'Failed to save team');
                throw error;
            }
        },
        [activeProfileId, addNotification, setTeams]
    );

    /**
     * Persists a new ship order for an existing team. Only `ship_ids` is
     * written, so the `(user_id, lower(name))` unique index cannot be violated.
     *
     * Unlike saveTeam this does NOT rethrow: the caller is a debounced
     * fire-and-forget reorder, so a failure is reported here (toast + log) and
     * the team's local order is reverted, leaving the user's working selection
     * untouched.
     */
    const updateTeamOrder = useCallback(
        async (id: string, shipIds: string[]) => {
            const team = teams.find((candidate) => candidate.id === id);
            if (!team) return;

            const previousShipIds = team.shipIds;

            void setTeams((prev) =>
                prev.map((candidate) =>
                    candidate.id === id ? { ...candidate, shipIds } : candidate
                )
            ); // Optimistic update

            if (!activeProfileId || !isSupabaseSyncEnabled()) {
                addNotification('success', `Saved new order for "${team.name}"`);
                return;
            }

            try {
                const { error } = await supabase
                    .from('autogear_teams')
                    .update({ ship_ids: shipIds })
                    .eq('id', id)
                    .eq('user_id', activeProfileId);

                if (error) throw error;

                addNotification('success', `Saved new order for "${team.name}"`);
            } catch (error) {
                console.error('Error updating autogear team order:', error);
                void setTeams((prev) =>
                    prev.map((candidate) =>
                        candidate.id === id ? { ...candidate, shipIds: previousShipIds } : candidate
                    )
                ); // Targeted revert
                addNotification('error', 'Failed to save the new order');
            }
        },
        [activeProfileId, addNotification, setTeams, teams]
    );

    const deleteTeam = useCallback(
        async (id: string) => {
            const previousTeams = teams;

            void setTeams((prev) => prev.filter((team) => team.id !== id)); // Optimistic update

            if (!activeProfileId || !isSupabaseSyncEnabled()) {
                addNotification('success', 'Team deleted');
                return;
            }

            try {
                const { error } = await supabase
                    .from('autogear_teams')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', activeProfileId);

                if (error) throw error;

                addNotification('success', 'Team deleted');
            } catch (error) {
                console.error('Error deleting autogear team:', error);
                void setTeams(previousTeams); // Revert optimistic update
                addNotification('error', 'Failed to delete team');
                throw error;
            }
        },
        [activeProfileId, addNotification, setTeams, teams]
    );

    return { teams, loading, saveTeam, updateTeamOrder, deleteTeam };
};
