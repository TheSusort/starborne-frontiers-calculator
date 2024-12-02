import { useState, useEffect, useCallback } from 'react';
import { GearPiece } from '../types/gear';

const STORAGE_KEY = 'gear-inventory';

export const useInventory = () => {
    const [inventory, setInventory] = useState<GearPiece[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadInventory = async () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            setInventory(stored ? JSON.parse(stored) : []);
        } catch (error) {
            console.error('Error loading inventory:', error);
            setError('Failed to load inventory');
        } finally {
            setLoading(false);
        }
    };

    const saveInventory = useCallback(async (newInventory: GearPiece[]) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newInventory));
            setError(null);
            setInventory(newInventory);
        } catch (error) {
            console.error('Error saving inventory:', error);
            setError('Failed to save inventory');
        }
    }, []);

    const getGearPiece = (gearId: string): GearPiece | undefined => {
        return inventory.find(gear => gear.id === gearId);
    };

    useEffect(() => {
        loadInventory();
    }, []);

    useEffect(() => {
        if (!loading) {
            saveInventory(inventory);
        }
    }, [inventory, loading, saveInventory]);

    return { 
        inventory, 
        loading, 
        error, 
        setInventory,
        saveInventory,
        loadInventory,
        getGearPiece
    };
};