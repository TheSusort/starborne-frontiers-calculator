import { useState, useEffect, useCallback } from 'react';
import { Ship } from '../types/ship';
import { GearSlotName } from '../constants/gearTypes';
import { GearPiece } from '../types/gear';
const STORAGE_KEY = 'ships';

interface UseShipsProps {
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export const useShips = ({ getGearPiece }: UseShipsProps = {}) => {
    const [ships, setShips] = useState<Ship[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingShip, setEditingShip] = useState<Ship | undefined>();
    const [initialized, setInitialized] = useState(false);

    // Load ships from localStorage on mount
    useEffect(() => {
        loadShips().then(() => setInitialized(true));
    }, []);

    const loadShips = async () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            setShips(stored ? JSON.parse(stored) : []);
        } catch (error) {
            console.error('Error loading ships:', error);
            setShips([]);
            setError('Failed to load ships');
        } finally {
            setLoading(false);
        }
    };

    const saveShips = useCallback(async (newShips: Ship[]) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newShips));
            setShips(newShips);
        } catch (error) {
            console.error('Error saving ships:', error);
            setError('Failed to save ships');
        }
    }, []);

    // Save ships changes to localStorage
    useEffect(() => {
        if (!loading && initialized) {
            saveShips(ships);
        }
    }, [ships, loading, saveShips, initialized]);

    const handleEquipGear = useCallback(
        async (shipId: string, slot: GearSlotName, gearId: string) => {
            // First update ships
            setShips((prev) => {
                const newShips = prev.map((ship) => {
                    // First check if the gear is equipped on a locked ship
                    if (
                        ship.id !== shipId &&
                        ship.equipmentLocked &&
                        Object.entries(ship.equipment).some(([_, id]) => id === gearId)
                    ) {
                        return ship;
                    }

                    // Remove the gear from any other unlocked ship that might have it equipped
                    if (
                        ship.id !== shipId &&
                        !ship.equipmentLocked &&
                        Object.entries(ship.equipment).some(([_, id]) => id === gearId)
                    ) {
                        const newEquipment = { ...ship.equipment };
                        Object.entries(newEquipment).forEach(([key, id]) => {
                            if (id === gearId) {
                                delete newEquipment[key as GearSlotName];
                            }
                        });
                        return {
                            ...ship,
                            equipment: newEquipment,
                        };
                    }

                    // Equip the gear to the target ship
                    if (ship.id === shipId) {
                        return {
                            ...ship,
                            equipment: {
                                ...ship.equipment,
                                [slot]: gearId,
                            },
                        };
                    }
                    return ship;
                });

                return newShips;
            });

            // Then update the gear's shipId in inventory
            if (getGearPiece) {
                const gear = getGearPiece(gearId);
                if (gear) {
                    const updatedGear = { ...gear, shipId };
                    const event = new CustomEvent('updateInventory', {
                        detail: { gear: updatedGear },
                    });
                    window.dispatchEvent(event);
                }
            }
        },
        [getGearPiece]
    );

    const handleRemoveGear = (shipId: string, slot: GearSlotName) => {
        setShips((prev) =>
            prev.map((ship) => {
                if (ship.id === shipId) {
                    const newEquipment = { ...ship.equipment };
                    delete newEquipment[slot];
                    return {
                        ...ship,
                        equipment: newEquipment,
                    };
                }
                return ship;
            })
        );
    };

    const handleRemoveShip = async (id: string) => {
        const newShips = ships.filter((ship) => ship.id !== id);
        await saveShips(newShips);
    };

    const handleSaveShip = async (ship: Ship) => {
        let newShips;
        if (editingShip) {
            newShips = ships.map((s) => (s.id === ship.id ? ship : s));
        } else {
            newShips = [...ships, ship];
        }

        await saveShips(newShips);
        setEditingShip(undefined);
    };

    const getShipById = (id: string) => {
        return ships.find((ship) => ship.id === id);
    };

    const updateShip = useCallback(
        async (updatedShip: Ship) => {
            const newShips = ships.map((ship) =>
                ship.id === updatedShip.id
                    ? {
                          ...updatedShip,
                      }
                    : ship
            );
            await saveShips(newShips);
        },
        [ships, saveShips]
    );

    const handleLockEquipment = async (ship: Ship) => {
        try {
            const newLockState = !ship.equipmentLocked;
            await updateShip({ ...ship, equipmentLocked: newLockState });
            return newLockState;
        } catch (error) {
            console.error('Failed to update equipment lock state:', error);
            throw error;
        }
    };

    const validateGearAssignments = useCallback(() => {
        if (!getGearPiece) return;

        const newShips = ships.map((ship) => {
            const newEquipment = { ...ship.equipment };
            let hasChanges = false;

            Object.entries(newEquipment).forEach(([slot, gearId]) => {
                if (gearId) {
                    const gear = getGearPiece(gearId);
                    if (!gear || (gear.shipId && gear.shipId !== ship.id)) {
                        delete newEquipment[slot];
                        hasChanges = true;
                    }
                }
            });

            return hasChanges ? { ...ship, equipment: newEquipment } : ship;
        });

        if (JSON.stringify(newShips) !== JSON.stringify(ships)) {
            setShips(newShips);
        }
    }, [ships, getGearPiece]);

    // Run validation when ships change or getGearPiece is provided
    useEffect(() => {
        if (getGearPiece && !loading && initialized) {
            validateGearAssignments();
        }
    }, [getGearPiece, loading, initialized, validateGearAssignments]);

    return {
        ships,
        loading,
        error,
        editingShip,
        setEditingShip,
        handleEquipGear,
        handleRemoveGear,
        handleRemoveShip,
        handleSaveShip,
        getShipById,
        updateShip,
        saveShips,
        validateGearAssignments,
        handleLockEquipment,
    };
};
