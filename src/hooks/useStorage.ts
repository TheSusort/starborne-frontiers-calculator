import { useState, useEffect, useCallback } from 'react';
import { useNotification } from './useNotification';
import { StorageKeyType } from '../constants/storage';

interface StorageConfig<T> {
    key: StorageKeyType;
    defaultValue: T;
    data?: T;
    onUpdate?: (data: T) => Promise<void>;
    useIndexedDB?: boolean; // Flag to force IndexedDB usage
}

// IndexedDB setup
const DB_NAME = 'starborneFrontiers';
const DB_VERSION = 1;
const STORE_NAME = 'data';

// Initialize IndexedDB
const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
};

// Helper to estimate data size
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const estimateDataSize = (data: any): number => {
    return new Blob([JSON.stringify(data)]).size;
};

// IndexedDB operations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getFromIndexedDB = async (key: string): Promise<any> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setInIndexedDB = async (key: string, value: any): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(value, key);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
};

export function useStorage<T>(config: StorageConfig<T>) {
    const { key, defaultValue, data, onUpdate, useIndexedDB = false } = config;
    const [localData, setLocalData] = useState<T>(() => {
        // Initialize from storage on mount
        if (useIndexedDB) {
            // For IndexedDB, we'll initialize with default value and update in useEffect
            return defaultValue;
        }

        const storedData = localStorage.getItem(key);
        if (storedData) {
            try {
                const parsedData = JSON.parse(storedData);
                if (Array.isArray(defaultValue)) {
                    return Array.isArray(parsedData)
                        ? parsedData.filter((item) => item !== null && item !== undefined)
                        : defaultValue;
                }
                return parsedData !== null && parsedData !== undefined ? parsedData : defaultValue;
            } catch (error) {
                console.error('Error parsing local data:', error);
                return defaultValue;
            }
        }
        return defaultValue;
    });

    const { addNotification } = useNotification();

    // Initialize IndexedDB data
    useEffect(() => {
        if (useIndexedDB) {
            getFromIndexedDB(key)
                .then((storedData) => {
                    if (storedData) {
                        setLocalData(storedData);
                    }
                })
                .catch((error) => {
                    console.error('Error loading from IndexedDB:', error);
                    addNotification('error', 'Failed to load data from storage');
                });
        }
    }, [key, useIndexedDB, addNotification]);

    // Sync data to storage when it changes
    useEffect(() => {
        if (data) {
            try {
                if (useIndexedDB) {
                    setInIndexedDB(key, data)
                        .then(() => setLocalData(data))
                        .catch((error) => {
                            console.error('Error syncing to IndexedDB:', error);
                            addNotification('error', 'Failed to sync data to storage');
                        });
                } else {
                    const newData = JSON.stringify(data);
                    const currentData = localStorage.getItem(key);
                    if (currentData !== newData) {
                        // Check if data size exceeds localStorage limit (5MB)
                        if (estimateDataSize(data) > 5 * 1024 * 1024) {
                            addNotification(
                                'warning',
                                'Data size exceeds localStorage limit. Consider using IndexedDB.'
                            );
                        }
                        localStorage.setItem(key, newData);
                        setLocalData(data);
                    }
                }
            } catch (error) {
                console.error('Error syncing data to storage:', error);
                addNotification('error', 'Failed to sync data to storage');
            }
        }
    }, [data, key, useIndexedDB, addNotification]);

    const saveData = useCallback(
        async (newData: T) => {
            try {
                if (useIndexedDB) {
                    await setInIndexedDB(key, newData);
                } else {
                    localStorage.setItem(key, JSON.stringify(newData));
                }
                setLocalData(newData);

                if (onUpdate) {
                    await onUpdate(newData);
                }
            } catch (error) {
                console.error('Error saving data:', error);
                addNotification('error', 'Failed to save data');
                throw error;
            }
        },
        [key, onUpdate, useIndexedDB, addNotification]
    );

    const setData = useCallback(
        (newData: T | ((prev: T) => T)) => {
            const updatedData =
                typeof newData === 'function' ? (newData as (prev: T) => T)(localData) : newData;
            return saveData(updatedData);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [saveData]
    );

    return {
        data: localData,
        setData,
    };
}
