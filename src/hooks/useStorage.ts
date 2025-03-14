import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthProvider';
import { firebaseStorage } from '../services/firebaseStorage';
import { useNotification } from './useNotification';
import { StorageKey } from '../constants/storage';

interface StorageConfig<T> {
    key: StorageKey;
    defaultValue: T;
    useRealtime?: boolean;
}

interface StorageResult<T> {
    data: T;
    loading: boolean;
    setData: (newData: T | ((prev: T) => T)) => Promise<void>;
    reload: () => Promise<void>;
}

// Overload for array types
export function useStorage<T extends { id: string }[]>(config: StorageConfig<T>): StorageResult<T>;
// Overload for non-array types (metadata)
export function useStorage<T extends Record<string, any>>(
    config: StorageConfig<T>
): StorageResult<T>;
// Implementation
export function useStorage<T>(config: StorageConfig<T>): StorageResult<T> {
    const { key, defaultValue, useRealtime = false } = config;
    const { user } = useAuth();
    const [data, setData] = useState<T>(defaultValue);
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();
    const isArrayData = Array.isArray(defaultValue);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const mountedRef = useRef(true);

    // Cleanup on unmount
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, []);

    // Handle data loading
    const handleLoadData = useCallback(async () => {
        if (!user?.uid || !mountedRef.current) return;

        try {
            if (isArrayData) {
                const items = await firebaseStorage.getItems<T>(user.uid, key, { force: false });
                if (mountedRef.current) {
                    setData(items as T);
                }
            } else {
                const metadata = await firebaseStorage.getUserMetadata(user.uid);
                if (metadata && mountedRef.current) {
                    setData((metadata as any)[key] || defaultValue);
                }
            }
        } catch (error) {
            console.error('Error loading data:', error);
            if (mountedRef.current) {
                addNotification('error', 'Failed to load data');
            }
        }
    }, [user?.uid, key, isArrayData, defaultValue, addNotification]);

    // Setup data synchronization
    useEffect(() => {
        if (!user?.uid) {
            setData(defaultValue);
            return;
        }

        setLoading(true);

        // Cleanup function
        const cleanup = () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };

        // Setup synchronization
        if (useRealtime && isArrayData) {
            cleanup(); // Clean up any existing listener
            unsubscribeRef.current = firebaseStorage.subscribeToCollection<T>(
                user.uid,
                key,
                (items) => {
                    if (mountedRef.current) {
                        setData(items as T);
                        setLoading(false);
                    }
                }
            );
        } else {
            cleanup();
            handleLoadData().finally(() => {
                if (mountedRef.current) {
                    setLoading(false);
                }
            });
        }

        return cleanup;
    }, [user?.uid, key, useRealtime, isArrayData]); // Removed handleLoadData from dependencies

    const saveData = useCallback(
        async (newData: T) => {
            if (!user?.uid || !mountedRef.current) return;

            try {
                if (isArrayData && Array.isArray(newData)) {
                    await firebaseStorage.saveItems(user.uid, key, newData as any[], {
                        merge: false,
                    });
                    if (!useRealtime) {
                        setData(newData);
                    }
                } else {
                    await firebaseStorage.updateUserMetadata(user.uid, { [key]: newData } as any);
                    setData(newData);
                }
            } catch (error) {
                console.error('Error saving data:', error);
                addNotification('error', 'Failed to save data');
            }
        },
        [user?.uid, key, isArrayData, useRealtime, addNotification]
    );

    const reload = useCallback(async () => {
        if (!user?.uid || !mountedRef.current) return;

        setLoading(true);
        try {
            if (isArrayData) {
                const items = await firebaseStorage.getItems<T>(user.uid, key, { force: true });
                if (mountedRef.current) {
                    setData(items as T);
                }
            } else {
                const metadata = await firebaseStorage.getUserMetadata(user.uid);
                if (metadata && mountedRef.current) {
                    setData((metadata as any)[key] || defaultValue);
                }
            }
        } catch (error) {
            console.error('Error reloading data:', error);
            if (mountedRef.current) {
                addNotification('error', 'Failed to reload data');
            }
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [user?.uid, key, isArrayData, defaultValue, addNotification]);

    return {
        data,
        setData: useCallback(
            async (newData: T | ((prev: T) => T)) => {
                const resolvedData =
                    typeof newData === 'function' ? (newData as (prev: T) => T)(data) : newData;
                await saveData(resolvedData);
            },
            [data, saveData]
        ),
        loading,
        reload,
    };
}
