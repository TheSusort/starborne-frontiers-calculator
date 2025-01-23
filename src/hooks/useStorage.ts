import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthProvider';
import { firebaseStorage, UserData } from '../services/firebaseStorage';
import { useNotification } from './useNotification';

interface StorageConfig<T> {
    key: string;
    defaultValue: T;
}

export function useStorage<T>(config: StorageConfig<T>) {
    const { key, defaultValue } = config;
    const { user } = useAuth();
    const [data, setData] = useState<T>(defaultValue);
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            // Always check localStorage first for faster loads
            const localData = localStorage.getItem(key);
            const hasLocalData = !!localData;

            if (hasLocalData) {
                setData(JSON.parse(localData));
            }

            // If user is logged in and it's initial load or login, sync with Firebase
            if (user?.uid) {
                const firebaseData = await firebaseStorage.getUserData(user.uid);

                if (firebaseData?.[key as keyof UserData]) {
                    // Firebase data exists - use it and update localStorage
                    const userData = firebaseData[key as keyof UserData] as T;
                    setData(userData);
                    localStorage.setItem(key, JSON.stringify(userData));
                } else if (hasLocalData) {
                    // No Firebase data but we have local data - migrate it
                    const parsedData = JSON.parse(localData);
                    await firebaseStorage.saveUserData(user.uid, {
                        [key]: parsedData,
                    });
                    addNotification('success', 'Data migrated to cloud storage');
                }
            }
        } catch (error) {
            console.error('Error loading data:', error);
            addNotification('error', 'Failed to load data');
        }
        setLoading(false);
    }, [key, user?.uid, addNotification]);

    const saveData = async (newData: T) => {
        try {
            // Always save to localStorage first
            localStorage.setItem(key, JSON.stringify(newData));
            setData(newData);

            // If user is logged in, sync to Firebase
            if (user?.uid) {
                await firebaseStorage.saveUserData(user.uid, {
                    [key]: newData,
                });
            }
        } catch (error) {
            console.error('Error saving data:', error);
            addNotification('error', 'Failed to save to cloud storage');
        }
    };

    // Load data on mount and when auth state changes
    useEffect(() => {
        if (isInitialLoad || user?.uid) {
            loadData();
            setIsInitialLoad(false);
        }
    }, [user?.uid, isInitialLoad, loadData]);

    // Clear localStorage when user logs out
    useEffect(() => {
        if (!user && data !== defaultValue) {
            localStorage.removeItem(key);
            setData(defaultValue);
        }
    }, [user, key, data, defaultValue]);

    return {
        data: data as T,
        setData: (newData: T | ((prev: T) => T)) =>
            saveData(typeof newData === 'function' ? (newData as (prev: T) => T)(data) : newData),
        loading,
        reload: loadData,
    };
}
