import { useState, useEffect } from 'react';
import { Ship } from '../types/ship';
import { GearSlot, GearPiece } from '../types/gear';
import { calculateTotalStats } from '../utils/statsCalculator';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export const useShips = () => {
    const [ships, setShips] = useState<Ship[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editingShip, setEditingShip] = useState<Ship | undefined>();

    const loadShips = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch(`${API_URL}/ships`);
            if (!response.ok) throw new Error('Failed to load ships');
            const data = await response.json();
            setShips(data);
        } catch (error) {
            console.error('Error loading ships:', error);
            setError('Failed to load ships. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    const saveShips = async (newShips: Ship[]) => {
        try {
            setError(null);
            const response = await fetch(`${API_URL}/ships`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newShips),
            });
            if (!response.ok) throw new Error('Failed to save ships');
            setShips(newShips);
        } catch (error) {
            console.error('Error saving ships:', error);
            setError('Failed to save ships. Please try again later.');
            throw error;
        }
    };

    const handleEquipGear = (shipId: string, slot: GearSlot, gear: GearPiece) => {
        setShips(prev => prev.map(ship => {
            if (ship.id === shipId) {
                const newEquipment = { ...ship.equipment, [slot]: gear };
                const totalStats = calculateTotalStats(ship.baseStats, newEquipment);
                return {
                    ...ship,
                    equipment: newEquipment,
                    stats: totalStats
                };
            }   
            return ship;
        }));
    };

    const handleRemoveGear = (shipId: string, slot: GearSlot) => {
        setShips(prev => prev.map(ship => {
            if (ship.id === shipId) {
                const newEquipment = { ...ship.equipment, [slot]: undefined };
                const totalStats = calculateTotalStats(ship.baseStats, newEquipment);
                return { ...ship, equipment: newEquipment, stats: totalStats };
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

    useEffect(() => {
        loadShips();
    }, []);

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
    };
}; 