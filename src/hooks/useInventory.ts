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
        useRealtime: true, // Enable real-time updates
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

    const updateGearPiece = useCallback(
        async (updatedGear: GearPiece) => {
            try {
                const existingIndex = inventory.findIndex((gear) => gear.id === updatedGear.id);
                if (existingIndex === -1) {
                    await setInventory([...inventory, updatedGear]);
                } else {
                    const existingGear = inventory[existingIndex];
                    if (JSON.stringify(existingGear) === JSON.stringify(updatedGear)) {
                        return;
                    }
                    await setInventory((prev) => {
                        const newInventory = [...prev];
                        newInventory[existingIndex] = updatedGear;
                        return newInventory;
                    });
                }
            } catch (error) {
                console.error('Error updating gear piece:', error);
                throw error;
            }
        },
        [inventory, setInventory]
    );

    const updateGearPieces = useCallback(
        async (updatedGears: GearPiece[]) => {
            try {
                await setInventory((prev) => {
                    const newInventory = [...prev];
                    let hasChanges = false;

                    updatedGears.forEach((updatedGear) => {
                        const existingIndex = newInventory.findIndex(
                            (gear) => gear.id === updatedGear.id
                        );
                        if (existingIndex === -1) {
                            newInventory.push(updatedGear);
                            hasChanges = true;
                        } else {
                            const existingGear = newInventory[existingIndex];
                            if (JSON.stringify(existingGear) !== JSON.stringify(updatedGear)) {
                                newInventory[existingIndex] = updatedGear;
                                hasChanges = true;
                            }
                        }
                    });

                    return hasChanges ? newInventory : prev;
                });
            } catch (error) {
                console.error('Error updating gear pieces:', error);
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
        let pendingUpdates: GearPiece[] = [];
        let timeoutId: NodeJS.Timeout | null = null;

        const handleInventoryUpdate = (event: CustomEvent<{ gear: GearPiece }>) => {
            const updatedGear = event.detail.gear;
            pendingUpdates.push(updatedGear);

            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(() => {
                if (pendingUpdates.length === 1) {
                    updateGearPiece(pendingUpdates[0]);
                } else {
                    updateGearPieces(pendingUpdates);
                }
                pendingUpdates = [];
                timeoutId = null;
            }, 2000);
        };

        window.addEventListener('updateInventory', handleInventoryUpdate as EventListener);

        return () => {
            window.removeEventListener('updateInventory', handleInventoryUpdate as EventListener);
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [updateGearPiece, updateGearPieces]);

    return {
        inventory,
        loading,
        error: null, // Handled by notifications now
        setInventory, // For full inventory updates
        saveInventory, // For backward compatibility
        updateGearPiece, // For single gear updates
        updateGearPieces, // For multiple gear updates
        loadInventory: reload,
        getGearPiece,
    };
};
