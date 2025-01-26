import { useCallback, useState, useEffect } from 'react';
import { Ship } from '../types/ship';
import { GearSlotName } from '../constants/gearTypes';
import { GearPiece } from '../types/gear';
import { useStorage } from './useStorage';
import { STORAGE_KEYS } from '../constants/storage';

const STORAGE_KEY = STORAGE_KEYS.SHIPS;

interface UseShipsProps {
    getGearPiece?: (id: string) => GearPiece | undefined;
}

export const useShips = ({ getGearPiece }: UseShipsProps = {}) => {
    const {
        data: ships = [],
        setData: setShips,
        loading,
    } = useStorage<Ship[]>({ key: STORAGE_KEY, defaultValue: [] });
    const [editingShip, setEditingShip] = useState<Ship | undefined>();

    const handleEquipGear = useCallback(
        async (shipId: string, slot: GearSlotName, gearId: string) => {
            setShips(
                ships.map((ship) => {
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
                })
            );

            // Update the gear's shipId in inventory
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
        [ships, getGearPiece, setShips]
    );

    const handleRemoveGear = useCallback(
        (shipId: string, slot: GearSlotName) => {
            setShips(
                ships.map((ship) => {
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
        },
        [ships, setShips]
    );

    const handleRemoveShip = useCallback(
        async (id: string) => {
            setShips(ships.filter((ship) => ship.id !== id));
        },
        [ships, setShips]
    );

    const handleSaveShip = useCallback(
        async (ship: Ship) => {
            const newShips = ships.some((s) => s.id === ship.id)
                ? ships.map((s) => (s.id === ship.id ? ship : s))
                : [...ships, ship];
            await setShips(newShips);
            setEditingShip(undefined);
        },
        [ships, setShips]
    );

    const getShipById = useCallback((id: string) => ships.find((ship) => ship.id === id), [ships]);

    const updateShip = useCallback(
        async (updatedShip: Ship) => {
            const newShips = ships.map((ship) =>
                ship.id === updatedShip.id
                    ? {
                          ...updatedShip,
                      }
                    : ship
            );
            await setShips(newShips);
        },
        [ships, setShips]
    );

    const handleLockEquipment = useCallback(
        async (ship: Ship) => {
            try {
                const newLockState = !ship.equipmentLocked;
                await updateShip({ ...ship, equipmentLocked: newLockState });
                return newLockState;
            } catch (error) {
                console.error('Failed to update equipment lock state:', error);
                throw error;
            }
        },
        [updateShip]
    );

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
    }, [ships, getGearPiece, setShips]);

    // Run validation when ships change or getGearPiece is provided
    useEffect(() => {
        if (getGearPiece && !loading) {
            validateGearAssignments();
        }
    }, [getGearPiece, loading, validateGearAssignments]);

    const handleUnequipAllGear = useCallback(
        async (shipId: string) => {
            setShips(
                ships.map((ship) => {
                    if (ship.id === shipId) {
                        // Get all equipped gear IDs before clearing
                        const equippedGear = Object.entries(ship.equipment)
                            .filter(([_, gearId]) => gearId)
                            .map(([_, gearId]) => gearId);

                        // Update inventory for each piece
                        equippedGear.forEach((gearId) => {
                            if (getGearPiece) {
                                const gear = getGearPiece(gearId as string);
                                if (gear) {
                                    const event = new CustomEvent('updateInventory', {
                                        detail: { gear: { ...gear, shipId: '' } },
                                    });
                                    window.dispatchEvent(event);
                                }
                            }
                        });

                        // Clear all equipment at once
                        return {
                            ...ship,
                            equipment: {},
                        };
                    }
                    return ship;
                })
            );
        },
        [ships, setShips, getGearPiece]
    );

    const handleEquipMultipleGear = useCallback(
        async (shipId: string, gearAssignments: { slot: GearSlotName; gearId: string }[]) => {
            setShips(
                ships.map((ship) => {
                    // First check if any of the gear is equipped on a locked ship
                    const lockedAssignments = gearAssignments.filter(({ gearId }) =>
                        ships.some(
                            (s) =>
                                s.id !== shipId &&
                                s.equipmentLocked &&
                                Object.values(s.equipment).includes(gearId)
                        )
                    );

                    if (lockedAssignments.length > 0) {
                        return ship;
                    }

                    // Handle the target ship
                    if (ship.id === shipId) {
                        const newEquipment = { ...ship.equipment };
                        gearAssignments.forEach(({ slot, gearId }) => {
                            newEquipment[slot] = gearId;
                        });
                        return { ...ship, equipment: newEquipment };
                    }

                    // Remove gear from other unlocked ships
                    if (!ship.equipmentLocked) {
                        const newEquipment = { ...ship.equipment };
                        let hasChanges = false;

                        Object.entries(newEquipment).forEach(([slot, currentGearId]) => {
                            if (
                                gearAssignments.some(
                                    (assignment) => assignment.gearId === currentGearId
                                )
                            ) {
                                delete newEquipment[slot as GearSlotName];
                                hasChanges = true;
                            }
                        });

                        if (hasChanges) {
                            return { ...ship, equipment: newEquipment };
                        }
                    }

                    return ship;
                })
            );

            // Update inventory shipIds
            if (getGearPiece) {
                gearAssignments.forEach(({ gearId }) => {
                    const gear = getGearPiece(gearId);
                    if (gear) {
                        const event = new CustomEvent('updateInventory', {
                            detail: { gear: { ...gear, shipId } },
                        });
                        window.dispatchEvent(event);
                    }
                });
            }
        },
        [ships, setShips, getGearPiece]
    );

    return {
        ships,
        loading,
        editingShip,
        setEditingShip,
        handleEquipGear,
        handleRemoveGear,
        handleRemoveShip,
        handleSaveShip,
        getShipById,
        updateShip,
        validateGearAssignments,
        handleLockEquipment,
        handleUnequipAllGear,
        handleEquipMultipleGear,
    };
};
