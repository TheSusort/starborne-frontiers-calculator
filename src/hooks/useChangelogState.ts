import { useCallback } from 'react';
import { useStorage } from './useStorage';
import { STORAGE_KEYS } from '../constants/storage';
import { ChangelogState } from '../types/changelog';

export const useChangelogState = () => {
    const {
        data: changelogState = { lastSeenVersion: '0.0.0' },
        setData: setChangelogState,
        loading,
    } = useStorage<ChangelogState>({
        key: STORAGE_KEYS.CHANGELOG_STATE,
        defaultValue: { lastSeenVersion: '0.0.0' },
        useRealtime: false, // Metadata doesn't need real-time updates
    });

    const updateLastSeenVersion = useCallback(
        (version: string) => {
            setChangelogState({
                lastSeenVersion: version,
            });
        },
        [setChangelogState]
    );

    return {
        changelogState,
        updateLastSeenVersion,
        loading,
    };
};
