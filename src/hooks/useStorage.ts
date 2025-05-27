import { useState, useEffect, useCallback } from 'react';
import { useNotification } from './useNotification';
import { StorageKeyType } from '../constants/storage';

interface StorageConfig<T> {
    key: StorageKeyType;
    defaultValue: T;
    data?: T;
    onUpdate?: (data: T) => Promise<void>;
}

export function useStorage<T>(config: StorageConfig<T>) {
    const { key, defaultValue, data, onUpdate } = config;
    const [localData, setLocalData] = useState<T>(() => {
        // Initialize from localStorage on mount
        const storedData = localStorage.getItem(key);
        if (storedData) {
            try {
                const parsedData = JSON.parse(storedData);
                // Ensure the parsed data is valid
                if (Array.isArray(defaultValue)) {
                    // If default value is an array, ensure parsed data is also an array
                    return Array.isArray(parsedData)
                        ? parsedData.filter((item) => item !== null && item !== undefined)
                        : defaultValue;
                }
                // For non-array data, just ensure it's not null/undefined
                return parsedData !== null && parsedData !== undefined ? parsedData : defaultValue;
            } catch (error) {
                console.error('Error parsing local data:', error);
                return defaultValue;
            }
        }
        return defaultValue;
    });

    const { addNotification } = useNotification();

    // Sync data to localStorage when it changes
    useEffect(() => {
        if (data) {
            try {
                localStorage.setItem(key, JSON.stringify(data));
                setLocalData(data);
            } catch (error) {
                console.error('Error syncing data to localStorage:', error);
                addNotification('error', 'Failed to sync data to local storage');
            }
        }
    }, [data, key, addNotification]);

    const saveData = useCallback(
        async (newData: T) => {
            try {
                // Update localStorage
                localStorage.setItem(key, JSON.stringify(newData));
                setLocalData(newData);

                // If we have an update function, call it
                if (onUpdate) {
                    await onUpdate(newData);
                }
            } catch (error) {
                console.error('Error saving data:', error);
                addNotification('error', 'Failed to save data');
                throw error;
            }
        },
        [key, onUpdate, addNotification]
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
