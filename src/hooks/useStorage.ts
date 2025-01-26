import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthProvider';
import { firebaseStorage, UserData } from '../services/firebaseStorage';
import { useNotification } from './useNotification';
import { StorageKey } from '../constants/storage';

interface StorageConfig<T> {
    key: StorageKey;
    defaultValue: T;
}

export function useStorage<T>(config: StorageConfig<T>) {
    const { key, defaultValue } = config;
    const { user } = useAuth();
    const [data, setData] = useState<T>(() => {
        // Initialize from localStorage on mount
        const localData = localStorage.getItem(key);
        if (localData) {
            try {
                const parsedData = JSON.parse(localData);
                if (Array.isArray(parsedData) && parsedData.length > 0) {
                    return parsedData as T;
                }
            } catch (error) {
                console.error('Error parsing local data:', error);
            }
        }
        return defaultValue;
    });
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();
    const prevUserRef = useRef(user?.uid);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            if (user?.uid) {
                const firebaseData = await firebaseStorage.getUserData(user.uid);
                if (firebaseData?.[key as keyof UserData]) {
                    const userData = firebaseData[key as keyof UserData] as T;
                    setData(userData);
                    localStorage.setItem(key, JSON.stringify(userData));
                }
            }
        } catch (error) {
            console.error('Error loading data:', error);
            addNotification('error', 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [key, user?.uid, addNotification]);

    // Load data on mount and when auth state changes
    useEffect(() => {
        const userChanged = prevUserRef.current !== user?.uid;
        if (userChanged) {
            if (!user) {
                // Handle logout
                localStorage.removeItem(key);
                setData(defaultValue);
            } else {
                // Handle login
                loadData();
            }
            prevUserRef.current = user?.uid;
        }
    }, [user, loadData, key, defaultValue]);

    // Initial load
    useEffect(() => {
        loadData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const saveData = async (newData: T) => {
        try {
            localStorage.setItem(key, JSON.stringify(newData));
            setData(newData);

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

    return {
        data: data as T,
        setData: (newData: T | ((prev: T) => T)) =>
            saveData(typeof newData === 'function' ? (newData as (prev: T) => T)(data) : newData),
        loading,
        reload: loadData,
    };
}
