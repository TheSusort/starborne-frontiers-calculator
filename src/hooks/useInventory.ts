import { useCallback, useEffect } from 'react';
import { GearPiece } from '../types/gear';
import { useStorage } from './useStorage';
import { STORAGE_KEYS } from '../constants/storage';

const STORAGE_KEY = STORAGE_KEYS.GEAR_INVENTORY;

export const useInventory = () => {
    const {
        data: inventory = [],
        setData: setInventory,
        loading,
        reload,
    } = useStorage<GearPiece[]>({
        key: STORAGE_KEY,
        defaultValue: [],
    });

    const saveInventory = useCallback(
        async (newInventory: GearPiece[]) => {
            try {
                await setInventory(newInventory);
            } catch (error) {
                console.error('Error saving inventory:', error);
                throw error;
            }
        },
        [setInventory]
    );

    const getGearPiece = useCallback(
        (gearId: string): GearPiece | undefined => {
            return gearId ? inventory?.find((gear) => gear.id === gearId) : undefined;
        },
        [inventory]
    );

    useEffect(() => {
        const handleInventoryUpdate = (event: CustomEvent<{ gear: GearPiece }>) => {
            const updatedGear = event.detail.gear;
            const newInventory = inventory?.map((gear) =>
                gear.id === updatedGear.id ? updatedGear : gear
            );
            // Save to localStorage when inventory is updated
            if (newInventory) {
                saveInventory(newInventory);
            }
        };

        window.addEventListener('updateInventory', handleInventoryUpdate as EventListener);

        return () => {
            window.removeEventListener('updateInventory', handleInventoryUpdate as EventListener);
        };
    }, [inventory, saveInventory]);

    return {
        inventory,
        loading,
        error: null, // Handled by notifications now
        setInventory,
        saveInventory,
        loadInventory: reload,
        getGearPiece,
    };
};
