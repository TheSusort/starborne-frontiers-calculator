import { useState, useEffect, useCallback } from 'react';
import { GearPiece } from '../types/gear';

const STORAGE_KEY = 'gear-inventory';

export const useInventory = () => {
    const [inventory, setInventory] = useState<GearPiece[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadInventory = async () => {
        setLoading(true);
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) {
                setInventory([]);
                return;
            }
            setInventory(JSON.parse(stored));
        } catch (error) {
            console.error('Error loading inventory:', error);
            setInventory([]);
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
        return gearId ? inventory.find((gear) => gear.id === gearId) : undefined;
    };

    useEffect(() => {
        loadInventory();
    }, []);

    return {
        inventory,
        loading,
        error,
        setInventory,
        saveInventory,
        loadInventory,
        getGearPiece,
    };
};
