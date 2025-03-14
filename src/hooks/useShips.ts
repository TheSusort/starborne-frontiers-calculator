import { useCallback, useState } from 'react';
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
        reload,
    } = useStorage<Ship[]>({
        key: STORAGE_KEY,
        defaultValue: [],
        useRealtime: true, // Enable real-time updates
    });
    const [editingShip, setEditingShip] = useState<Ship | undefined>();

    const handleEquipGear = useCallback(
        async (shipId: string, slot: GearSlotName, gearId: string) => {
            await setShips(
                ships.map((ship) => {
                    // Check if the gear is equipped on a locked ship
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
        async (shipId: string, slot: GearSlotName) => {
            await setShips(
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
            await setShips(ships.filter((ship) => ship.id !== id));
        },
        [ships, setShips]
    );

    const handleSaveShip = useCallback(
        async (ship: Ship) => {
            await setShips(
                ships.some((s) => s.id === ship.id)
                    ? ships.map((s) => (s.id === ship.id ? ship : s))
                    : [...ships, ship]
            );
            setEditingShip(undefined);
        },
        [ships, setShips]
    );

    const getShipById = useCallback((id: string) => ships.find((ship) => ship.id === id), [ships]);

    const handleLockEquipment = useCallback(
        async (ship: Ship) => {
            try {
                const newLockState = !ship.equipmentLocked;
                await setShips(
                    ships.map((s) =>
                        s.id === ship.id ? { ...ship, equipmentLocked: newLockState } : s
                    )
                );
                return newLockState;
            } catch (error) {
                console.error('Failed to update equipment lock state:', error);
                throw error;
            }
        },
        [ships, setShips]
    );

    const handleUnequipAllGear = useCallback(
        async (shipId: string) => {
            await setShips(
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
        async (
            shipId: string,
            gearAssignments: { slot: GearSlotName; gearId: string }[],
            lockOnEquip: boolean = false
        ) => {
            await setShips(
                ships.map((ship) => {
                    // Check if any of the gear is equipped on a locked ship
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
                        return {
                            ...ship,
                            equipment: newEquipment,
                            equipmentLocked: lockOnEquip ? true : ship.equipmentLocked,
                        };
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
        handleLockEquipment,
        handleUnequipAllGear,
        handleEquipMultipleGear,
    };
};
