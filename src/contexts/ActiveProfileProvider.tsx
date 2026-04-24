import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { StorageKey } from '../constants/storage';
import { useNotification } from '../hooks/useNotification';
import {
    listProfiles,
    createAlt as createAltApi,
    renameAlt as renameAltApi,
    setAltPublic as setAltPublicApi,
    deleteAlt as deleteAltApi,
    type ProfileRow,
} from '../services/altAccountService';
import { useAuth } from './AuthProvider';

export const PROFILE_SWITCH_EVENT = 'app:profile:switch';

/**
 * Pure helper — no React, no globals.
 * Resolves which profile id should be active given:
 *  - the auth user id (or null if unauthenticated)
 *  - the id persisted in localStorage (or null if none)
 *  - the full profiles list from the DB
 *
 * Rules:
 *  1. No auth user → null.
 *  2. storedId is in the profiles list → storedId.
 *  3. Otherwise (null, missing, or equals authUserId) → authUserId.
 */
export const resolveActiveProfileId = (
    authUserId: string | null,
    storedId: string | null,
    profiles: ProfileRow[]
): string | null => {
    if (!authUserId) return null;
    if (storedId && storedId !== authUserId && profiles.some((p) => p.id === storedId))
        return storedId;
    return authUserId;
};

interface ActiveProfileContextType {
    activeProfileId: string | null;
    activeProfile: ProfileRow | null;
    profiles: ProfileRow[];
    isOnAlt: boolean;
    profilesLoading: boolean;
    switchProfile: (id: string) => void;
    createAlt: (username: string) => Promise<ProfileRow>;
    renameAlt: (id: string, username: string) => Promise<void>;
    togglePublicAlt: (id: string, isPublic: boolean) => Promise<void>;
    deleteAlt: (id: string) => Promise<void>;
    refreshProfiles: () => Promise<void>;
}

const ActiveProfileContext = createContext<ActiveProfileContextType | undefined>(undefined);

export const ActiveProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { addNotification } = useNotification();
    const [profiles, setProfiles] = useState<ProfileRow[]>([]);
    const [profilesLoading, setProfilesLoading] = useState(true);
    const [storedId, setStoredId] = useState<string | null>(() =>
        localStorage.getItem(StorageKey.ACTIVE_PROFILE_ID)
    );
    const lastNotifiedStaleRef = useRef<string | null>(null);

    const activeProfileId = useMemo(
        () => resolveActiveProfileId(user?.id ?? null, storedId, profiles),
        [user?.id, storedId, profiles]
    );

    // Notify once when a stored alt id is no longer in the profiles list (deleted elsewhere).
    useEffect(() => {
        if (!user?.id || profilesLoading) return;
        if (
            storedId &&
            storedId !== user.id &&
            !profiles.some((p) => p.id === storedId) &&
            lastNotifiedStaleRef.current !== storedId
        ) {
            lastNotifiedStaleRef.current = storedId;
            localStorage.removeItem(StorageKey.ACTIVE_PROFILE_ID);
            setStoredId(null);
            addNotification('info', 'Alt no longer exists — switched to main.');
        }
    }, [user?.id, storedId, profiles, profilesLoading, addNotification]);

    const activeProfile = useMemo(
        () => profiles.find((p) => p.id === activeProfileId) ?? null,
        [profiles, activeProfileId]
    );

    const refreshProfiles = useCallback(async () => {
        if (!user?.id) {
            setProfiles([]);
            setProfilesLoading(false);
            return;
        }
        setProfilesLoading(true);
        try {
            const rows = await listProfiles(user.id);
            setProfiles(rows);
        } catch (err) {
            console.error('Failed to load profiles', err);
            addNotification('error', 'Failed to load profiles');
        } finally {
            setProfilesLoading(false);
        }
    }, [user?.id, addNotification]);

    // Fetch profiles on mount and whenever auth user changes (sign-in).
    useEffect(() => {
        void refreshProfiles();
    }, [refreshProfiles]);

    // Sign-out: clear the stored profile id so a different account on the same device starts fresh.
    useEffect(() => {
        const onSignout = () => {
            lastNotifiedStaleRef.current = null; // reset so the next user gets the notification if they have a stale id
            localStorage.removeItem(StorageKey.ACTIVE_PROFILE_ID);
            setStoredId(null);
            setProfiles([]);
        };
        window.addEventListener('app:signout', onSignout);
        return () => window.removeEventListener('app:signout', onSignout);
    }, []);

    const switchProfile = useCallback(
        (id: string) => {
            if (id === activeProfileId) return;
            const isMain = id === user?.id;
            if (isMain) {
                localStorage.removeItem(StorageKey.ACTIVE_PROFILE_ID);
                setStoredId(null);
            } else {
                localStorage.setItem(StorageKey.ACTIVE_PROFILE_ID, id);
                setStoredId(id);
            }
            window.dispatchEvent(
                new CustomEvent(PROFILE_SWITCH_EVENT, { detail: { profileId: id } })
            );
        },
        [activeProfileId, user?.id]
    );

    const createAlt = useCallback(
        async (username: string): Promise<ProfileRow> => {
            if (!user?.id) throw new Error('Not authenticated');
            const row = await createAltApi(user.id, username);
            await refreshProfiles();
            return row;
        },
        [user?.id, refreshProfiles]
    );

    const renameAlt = useCallback(
        async (id: string, username: string) => {
            if (!user?.id) throw new Error('Not authenticated');
            await renameAltApi(id, user.id, username);
            await refreshProfiles();
        },
        [user?.id, refreshProfiles]
    );

    const togglePublicAlt = useCallback(
        async (id: string, isPublic: boolean) => {
            if (!user?.id) throw new Error('Not authenticated');
            await setAltPublicApi(id, user.id, isPublic);
            await refreshProfiles();
        },
        [user?.id, refreshProfiles]
    );

    const deleteAlt = useCallback(
        async (id: string) => {
            if (!user?.id) throw new Error('Not authenticated');
            // Switch off the alt BEFORE deleting to avoid an "active profile vanished" race.
            if (activeProfileId === id) {
                switchProfile(user.id);
            }
            await deleteAltApi(id, user.id);
            await refreshProfiles();
        },
        [user?.id, activeProfileId, switchProfile, refreshProfiles]
    );

    const value = useMemo<ActiveProfileContextType>(
        () => ({
            activeProfileId,
            activeProfile,
            profiles,
            isOnAlt: activeProfileId !== null && activeProfileId !== user?.id,
            profilesLoading,
            switchProfile,
            createAlt,
            renameAlt,
            togglePublicAlt,
            deleteAlt,
            refreshProfiles,
        }),
        [
            activeProfileId,
            activeProfile,
            profiles,
            profilesLoading,
            user?.id,
            switchProfile,
            createAlt,
            renameAlt,
            togglePublicAlt,
            deleteAlt,
            refreshProfiles,
        ]
    );

    return <ActiveProfileContext.Provider value={value}>{children}</ActiveProfileContext.Provider>;
};

export const useActiveProfile = () => {
    const ctx = useContext(ActiveProfileContext);
    if (!ctx) throw new Error('useActiveProfile must be used within ActiveProfileProvider');
    return ctx;
};
