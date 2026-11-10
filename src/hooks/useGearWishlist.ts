import { useCallback, useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { WishlistEntry } from '../types/wishlist';
import { supabase } from '../config/supabase';
import { useActiveProfile, PROFILE_SWITCH_EVENT } from '../contexts/ActiveProfileProvider';
import { StorageKey } from '../constants/storage';
import { isSupabaseSyncEnabled } from '../utils/syncUtils';
import { moveWishlistEntry, moveWishlistGroup } from '../utils/wishlist/moveWishlistEntry';
import { insertWishlistEntries } from '../utils/wishlist/groupWishlistEntries';
import { useStorage } from './useStorage';

export const useGearWishlist = () => {
    const { activeProfileId } = useActiveProfile();
    const [loading, setLoading] = useState(true);

    const { data: entries, setData: setEntries } = useStorage<WishlistEntry[]>({
        key: StorageKey.GEAR_WISHLIST,
        defaultValue: [],
    });

    const loadEntries = useCallback(async () => {
        try {
            setLoading(true);
            if (activeProfileId) {
                const { data, error } = await supabase
                    .from('gear_wishlists')
                    .select('entries')
                    .eq('user_id', activeProfileId)
                    .single();

                // PGRST116 = "no rows returned" — user has no wishlist row yet, that's fine
                if (error && error.code !== 'PGRST116') throw error;
                if (data) {
                    void setEntries(data.entries as WishlistEntry[]);
                }
            }
        } catch (error) {
            console.error('Error loading gear wishlist:', error);
        } finally {
            setLoading(false);
        }
    }, [activeProfileId, setEntries]);

    useEffect(() => {
        void loadEntries();
    }, [loadEntries]);

    // Clear on sign-out so wishlist doesn't leak across accounts
    useEffect(() => {
        const handleSignOut = () => void setEntries([]);
        window.addEventListener('app:signout', handleSignOut);
        return () => window.removeEventListener('app:signout', handleSignOut);
    }, [setEntries]);

    // Reload on profile switch
    useEffect(() => {
        const handleProfileSwitch = () => {
            void setEntries([]);
            void loadEntries();
        };
        window.addEventListener(PROFILE_SWITCH_EVENT, handleProfileSwitch);
        return () => window.removeEventListener(PROFILE_SWITCH_EVENT, handleProfileSwitch);
    }, [loadEntries, setEntries]);

    const upsertToSupabase = useCallback(
        async (updatedEntries: WishlistEntry[]) => {
            if (!activeProfileId || !isSupabaseSyncEnabled()) return;
            const { error } = await supabase.from('gear_wishlists').upsert(
                {
                    user_id: activeProfileId,
                    entries: updatedEntries,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'user_id' }
            );
            if (error) throw error;
        },
        [activeProfileId]
    );

    /** Writes `updatedEntries` optimistically, rolling back if the upsert fails. */
    const commit = useCallback(
        async (updatedEntries: WishlistEntry[]) => {
            const previous = entries;
            void setEntries(updatedEntries);
            try {
                await upsertToSupabase(updatedEntries);
            } catch (error) {
                void setEntries(previous); // rollback
                throw error;
            }
        },
        [entries, setEntries, upsertToSupabase]
    );

    /** Adds `added` and removes `replaceIds` in one write; placement is `insertWishlistEntries`'. */
    const addEntries = useCallback(
        async (added: Omit<WishlistEntry, 'id'>[], replaceIds: string[] = []) => {
            const newEntries = added.map((entry) => ({ ...entry, id: uuidv4() }));
            await commit(insertWishlistEntries(entries, newEntries, replaceIds));
        },
        [commit, entries]
    );

    const addEntry = useCallback(
        (entry: Omit<WishlistEntry, 'id'>) => addEntries([entry]),
        [addEntries]
    );

    const updateEntry = useCallback(
        (updated: WishlistEntry) => commit(entries.map((e) => (e.id === updated.id ? updated : e))),
        [commit, entries]
    );

    const deleteEntry = useCallback(
        (id: string) => commit(entries.filter((e) => e.id !== id)),
        [commit, entries]
    );

    const moveEntry = useCallback(
        async (id: string, offset: -1 | 1) => {
            const updatedEntries = moveWishlistEntry(entries, id, offset);
            if (updatedEntries !== entries) await commit(updatedEntries);
        },
        [commit, entries]
    );

    const moveGroup = useCallback(
        async (group: string, offset: -1 | 1) => {
            const updatedEntries = moveWishlistGroup(entries, group, offset);
            if (updatedEntries !== entries) await commit(updatedEntries);
        },
        [commit, entries]
    );

    return {
        entries,
        loading,
        addEntry,
        addEntries,
        updateEntry,
        deleteEntry,
        moveEntry,
        moveGroup,
    };
};
