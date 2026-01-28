import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../config/supabase';
import { LocalEncounterNote, SharedEncounterNote, Position } from '../types/encounters';
import { useAuth } from '../contexts/AuthProvider';
import { useNotification } from './useNotification';
import { useShips } from '../contexts/ShipsContext';

interface RawEncounterFormation {
    note_id: string;
    position: string;
    ship_id: string | null;
    ship_name: string | null;
}

interface RawEncounterNote {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    is_public: boolean;
    votes: number;
    user_name: string | null;
    created_at: string;
    encounter_formations: RawEncounterFormation[];
}

interface RawEncounterVote {
    encounter_id: string;
    user_id: string;
    vote: number;
}

export const useSharedEncounters = () => {
    const [sharedEncounters, setSharedEncounters] = useState<SharedEncounterNote[]>([]);
    const [userVotes, setUserVotes] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();
    const { addNotification } = useNotification();
    const { ships } = useShips();

    const fetchSharedEncounters = useCallback(async () => {
        try {
            setLoading(true);

            // Fetch public encounters with their formations
            const { data, error } = await supabase
                .from('encounter_notes')
                .select(
                    `
                    *,
                    encounter_formations (*)
                `
                )
                .eq('is_public', true)
                .order('votes', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;

            const encounters: SharedEncounterNote[] = (data as RawEncounterNote[]).map((note) => ({
                id: note.id,
                name: note.name,
                description: note.description || undefined,
                isPublic: note.is_public,
                formation: note.encounter_formations.map((f) => ({
                    shipId: f.ship_id || '',
                    shipName: f.ship_name || '',
                    position: f.position as Position,
                })),
                userId: note.user_id,
                userName: note.user_name || 'Anonymous',
                createdAt: new Date(note.created_at).getTime(),
                votes: note.votes || 0,
                userVotes: {}, // Will be populated from separate query
            }));

            setSharedEncounters(encounters);

            // Fetch user's votes if logged in
            if (user?.id) {
                const { data: votesData, error: votesError } = await supabase
                    .from('encounter_votes')
                    .select('encounter_id, vote')
                    .eq('user_id', user.id);

                if (votesError) throw votesError;

                const votesMap: Record<string, number> = {};
                (votesData as RawEncounterVote[]).forEach((v) => {
                    votesMap[v.encounter_id] = v.vote;
                });
                setUserVotes(votesMap);
            }
        } catch (error) {
            console.error('Failed to fetch shared encounters:', error);
            addNotification('error', 'Failed to load shared encounters');
        } finally {
            setLoading(false);
        }
    }, [user?.id, addNotification]);

    useEffect(() => {
        fetchSharedEncounters();
    }, [fetchSharedEncounters]);

    const shareEncounter = async (encounter: LocalEncounterNote) => {
        if (!user) {
            throw new Error('User must be logged in to share encounters');
        }

        try {
            // Build formation with ship names
            const sharedFormation = encounter.formation.map(({ shipId, position }) => {
                const ship = ships.find((s) => s.id === shipId);
                if (!ship) {
                    throw new Error(`Ship with ID ${shipId} not found`);
                }
                return {
                    shipId,
                    shipName: ship.name,
                    position,
                };
            });

            // Update the existing encounter to be public
            const { error: noteError } = await supabase
                .from('encounter_notes')
                .update({
                    is_public: true,
                    votes: 0,
                    user_name: user.displayName || 'Anonymous',
                })
                .eq('id', encounter.id)
                .eq('user_id', user.id);

            if (noteError) throw noteError;

            // Update formation records with ship names
            for (const pos of sharedFormation) {
                const { error: formationError } = await supabase
                    .from('encounter_formations')
                    .update({ ship_name: pos.shipName })
                    .eq('note_id', encounter.id)
                    .eq('position', pos.position);

                if (formationError) throw formationError;
            }

            const newEncounter: SharedEncounterNote = {
                id: encounter.id,
                name: encounter.name,
                description: encounter.description,
                isPublic: true,
                formation: sharedFormation,
                userId: user.id,
                userName: user.displayName || 'Anonymous',
                createdAt: encounter.createdAt,
                votes: 0,
                userVotes: {},
            };

            setSharedEncounters((prev) => [newEncounter, ...prev]);
            addNotification('success', 'Encounter shared successfully');
            return newEncounter;
        } catch (error) {
            console.error('Failed to share encounter:', error);
            addNotification('error', 'Failed to share encounter');
            throw error;
        }
    };

    const unshareEncounter = async (encounterId: string) => {
        if (!user) {
            throw new Error('User must be logged in to unshare encounters');
        }

        try {
            // Update the encounter to be private (not public)
            const { error: noteError } = await supabase
                .from('encounter_notes')
                .update({ is_public: false })
                .eq('id', encounterId)
                .eq('user_id', user.id);

            if (noteError) throw noteError;

            // Delete any votes for this encounter
            const { error: votesError } = await supabase
                .from('encounter_votes')
                .delete()
                .eq('encounter_id', encounterId);

            if (votesError) throw votesError;

            setSharedEncounters((prev) => prev.filter((encounter) => encounter.id !== encounterId));
            addNotification('success', 'Encounter unshared successfully');
        } catch (error) {
            console.error('Failed to unshare encounter:', error);
            addNotification('error', 'Failed to unshare encounter');
            throw error;
        }
    };

    const voteEncounter = async (encounterId: string, vote: number) => {
        if (!user) {
            throw new Error('User must be logged in to vote');
        }

        // Normalize vote to -1, 0, or 1
        const normalizedVote = vote === 0 ? 0 : vote > 0 ? 1 : -1;
        const currentVote = userVotes[encounterId] || 0;

        if (normalizedVote === currentVote) {
            return; // No change in vote
        }

        try {
            if (normalizedVote === 0) {
                // Remove vote
                const { error } = await supabase
                    .from('encounter_votes')
                    .delete()
                    .eq('encounter_id', encounterId)
                    .eq('user_id', user.id);

                if (error) throw error;
            } else {
                // Upsert vote
                const { error } = await supabase.from('encounter_votes').upsert(
                    {
                        encounter_id: encounterId,
                        user_id: user.id,
                        vote: normalizedVote,
                    },
                    {
                        onConflict: 'encounter_id,user_id',
                    }
                );

                if (error) throw error;
            }

            // Update local state
            const voteChange = normalizedVote - currentVote;

            setUserVotes((prev) => {
                if (normalizedVote === 0) {
                    const { [encounterId]: _, ...rest } = prev;
                    return rest;
                }
                return { ...prev, [encounterId]: normalizedVote };
            });

            setSharedEncounters((prev) =>
                prev
                    .map((e) => (e.id === encounterId ? { ...e, votes: e.votes + voteChange } : e))
                    .sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt)
            );

            addNotification('success', 'Vote recorded successfully');
        } catch (error) {
            console.error('Failed to vote on encounter:', error);
            addNotification('error', 'Failed to record vote');
            throw error;
        }
    };

    // Transform sharedEncounters to include userVotes for API compatibility
    const encountersWithVotes = sharedEncounters.map((encounter) => ({
        ...encounter,
        userVotes: user?.id ? { [user.id]: userVotes[encounter.id] || 0 } : {},
    }));

    return {
        sharedEncounters: encountersWithVotes,
        loading,
        shareEncounter,
        unshareEncounter,
        voteEncounter,
    };
};
