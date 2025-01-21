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

    const getGearPiece = useCallback(
        (gearId: string): GearPiece | undefined => {
            return gearId ? inventory.find((gear) => gear.id === gearId) : undefined;
        },
        [inventory]
    );

    useEffect(() => {
        loadInventory();
    }, []);

    useEffect(() => {
        const handleInventoryUpdate = (event: CustomEvent<{ gear: GearPiece }>) => {
            const updatedGear = event.detail.gear;
            const newInventory = inventory.map((gear) =>
                gear.id === updatedGear.id ? updatedGear : gear
            );
            // Save to localStorage when inventory is updated
            saveInventory(newInventory);
        };

        window.addEventListener('updateInventory', handleInventoryUpdate as EventListener);

        return () => {
            window.removeEventListener('updateInventory', handleInventoryUpdate as EventListener);
        };
    }, [inventory, saveInventory]);

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
