import { useState, useEffect, useCallback } from 'react';
import { Ship } from '../types/ship';
import { GearSlotName } from '../constants/gearTypes';
import { calculateTotalStats } from '../utils/statsCalculator';
import { useInventory } from './useInventory';
const STORAGE_KEY = 'ships';

export const useShips = () => {
    const [ships, setShips] = useState<Ship[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingShip, setEditingShip] = useState<Ship | undefined>();
    const { getGearPiece } = useInventory();

    // Load ships from localStorage on mount
    useEffect(() => {
        loadShips();
    }, []);

    const loadShips = async () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            setShips(stored ? JSON.parse(stored) : []);
        } catch (error) {
            console.error('Error loading ships:', error);
            setError('Failed to load ships');
        } finally {
            setLoading(false);
        }
    };

    const saveShips = useCallback(async (newShips: Ship[]) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newShips));
            setError(null);
            setShips(newShips);
        } catch (error) {
            console.error('Error saving ships:', error);
            setError('Failed to save ships');
        }
    }, []);

    // Save ships changes to localStorage
    useEffect(() => {
        if (!loading) {
            saveShips(ships);
        }
    }, [ships, loading, saveShips]);

    const handleEquipGear = (shipId: string, slot: GearSlotName, gearId: string) => {
        setShips(prev => prev.map(ship => {
            if (ship.id === shipId) {
                return {
                    ...ship,
                    equipment: {
                        ...ship.equipment,
                        [slot]: gearId
                    },
                    stats: calculateTotalStats(ship.baseStats, { ...ship.equipment, [slot]: gearId }, getGearPiece)
                };
            }
            return ship;
        }));
    };

    const handleRemoveGear = (shipId: string, slot: GearSlotName) => {
        setShips(prev => prev.map(ship => {
            if (ship.id === shipId) {
                const newEquipment = { ...ship.equipment };
                delete newEquipment[slot];
                return {
                    ...ship,
                    equipment: newEquipment,
                    stats: calculateTotalStats(ship.baseStats, newEquipment, getGearPiece)
                };
            }
            return ship;
        }));
    };

    const handleRemoveShip = async (id: string) => {
        const newShips = ships.filter(ship => ship.id !== id);
        await saveShips(newShips);
    };

    const handleSaveShip = async (ship: Ship) => {
        let newShips;
        if (editingShip) {
            newShips = ships.map(s => s.id === ship.id ? ship : s);
        } else {
            newShips = [...ships, ship];
        }

        await saveShips(newShips);
        setEditingShip(undefined);
    };

    const getShipById = (id: string) => {
        return ships.find(ship => ship.id === id);
    };

    const updateShip = useCallback((updatedShip: Ship) => {
        setShips(prev => prev.map(ship =>
            ship.id === updatedShip.id ? {
                ...updatedShip,
                stats: calculateTotalStats(updatedShip.baseStats, updatedShip.equipment, getGearPiece)
            } : ship
        ));
    }, [getGearPiece]);

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
    };
};