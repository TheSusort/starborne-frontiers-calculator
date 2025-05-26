import { useState, useEffect } from 'react';
import {
    collection,
    query,
    orderBy,
    getDocs,
    addDoc,
    deleteDoc,
    doc,
    where,
    updateDoc,
    increment,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { LocalEncounterNote, SharedEncounterNote } from '../types/encounters';
import { useAuth } from '../contexts/AuthProvider';
import { useNotification } from './useNotification';
import { useShips } from '../contexts/ShipsContext';

export const useSharedEncounters = () => {
    const [sharedEncounters, setSharedEncounters] = useState<SharedEncounterNote[]>([]);
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();
    const { addNotification } = useNotification();
    const { ships } = useShips();

    useEffect(() => {
        const fetchSharedEncounters = async () => {
            try {
                const sharedEncountersRef = collection(db, 'sharedEncounters');

                const q = query(
                    sharedEncountersRef,
                    orderBy('votes', 'desc'),
                    orderBy('createdAt', 'desc')
                );

                const querySnapshot = await getDocs(q);

                const encounters = querySnapshot.docs.map((doc) => {
                    const data = doc.data();
                    // Validate the data structure
                    if (!data.votes || typeof data.votes !== 'number') {
                        data.votes = 0;
                    }
                    if (!data.userVotes || typeof data.userVotes !== 'object') {
                        data.userVotes = {};
                    }
                    if (!data.createdAt || typeof data.createdAt !== 'number') {
                        data.createdAt = Date.now();
                    }
                    if (!data.formation || !Array.isArray(data.formation)) {
                        data.formation = [];
                    }
                    if (!data.userId || typeof data.userId !== 'string') {
                        data.userId = 'unknown';
                    }
                    if (!data.userName || typeof data.userName !== 'string') {
                        data.userName = 'Anonymous';
                    }
                    if (!data.name || typeof data.name !== 'string') {
                        data.name = 'Unnamed Encounter';
                    }

                    const encounter: SharedEncounterNote = {
                        id: doc.id,
                        name: data.name,
                        description: data.description,
                        formation: data.formation,
                        userId: data.userId,
                        userName: data.userName,
                        createdAt: data.createdAt,
                        votes: data.votes,
                        userVotes: data.userVotes,
                    };

                    return encounter;
                });

                setSharedEncounters(encounters);
            } catch (error) {
                console.error('Failed to fetch shared encounters:', error);
                addNotification('error', 'Failed to load shared encounters');
            } finally {
                setLoading(false);
            }
        };

        fetchSharedEncounters();
    }, [addNotification]);

    const shareEncounter = async (encounter: LocalEncounterNote) => {
        if (!user) {
            throw new Error('User must be logged in to share encounters');
        }

        try {
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

            const sharedEncounter: Omit<SharedEncounterNote, 'id'> = {
                ...encounter,
                formation: sharedFormation,
                userId: user.id,
                userName: user.displayName || 'Anonymous',
                createdAt: Date.now(),
                votes: 0,
                userVotes: {},
            };

            const docRef = await addDoc(collection(db, 'sharedEncounters'), sharedEncounter);

            const newEncounter: SharedEncounterNote = {
                ...sharedEncounter,
                id: docRef.id,
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
            const sharedEncountersRef = collection(db, 'sharedEncounters');
            const q = query(
                sharedEncountersRef,
                where('userId', '==', user.id),
                where('id', '==', encounterId)
            );
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                throw new Error('Shared encounter not found');
            }

            const sharedEncounterDoc = querySnapshot.docs[0];
            await deleteDoc(doc(db, 'sharedEncounters', sharedEncounterDoc.id));

            setSharedEncounters((prev) =>
                prev.filter((encounter) => encounter.id !== sharedEncounterDoc.id)
            );
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

        try {
            const encounterRef = doc(db, 'sharedEncounters', encounterId);
            const encounter = sharedEncounters.find((e) => e.id === encounterId);

            if (!encounter) {
                throw new Error('Encounter not found');
            }

            const currentVote = encounter.userVotes[user.id] || 0;
            const voteChange = vote - currentVote;

            if (voteChange === 0) {
                return; // No change in vote
            }

            await updateDoc(encounterRef, {
                votes: increment(voteChange),
                [`userVotes.${user.id}`]: vote,
            });

            setSharedEncounters((prev) =>
                prev
                    .map((e) =>
                        e.id === encounterId
                            ? {
                                  ...e,
                                  votes: e.votes + voteChange,
                                  userVotes: {
                                      ...e.userVotes,
                                      [user.id]: vote,
                                  },
                              }
                            : e
                    )
                    .sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt)
            );

            addNotification('success', 'Vote recorded successfully');
        } catch (error) {
            console.error('Failed to vote on encounter:', error);
            addNotification('error', 'Failed to record vote');
            throw error;
        }
    };

    return {
        sharedEncounters,
        loading,
        shareEncounter,
        unshareEncounter,
        voteEncounter,
    };
};
