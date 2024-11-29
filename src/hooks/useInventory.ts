import { useState, useEffect } from 'react';
import { GearPiece } from '../types/gear';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export const useInventory = () => {
    const [inventory, setInventory] = useState<GearPiece[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadInventory = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch(`${API_URL}/inventory`);
            if (!response.ok) throw new Error('Failed to load inventory');
            const data = await response.json();
            setInventory(data);
        } catch (error) {
            console.error('Error loading inventory:', error);
            setError('Failed to load inventory. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    const saveInventory = async (newInventory: GearPiece[]) => {
        try {
            setError(null);
            const response = await fetch(`${API_URL}/inventory`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newInventory),
            });
            if (!response.ok) throw new Error('Failed to save inventory');
            setInventory(newInventory);
        } catch (error) {
            console.error('Error saving inventory:', error);
            setError('Failed to save inventory. Please try again later.');
            throw error; // Re-throw to allow handling in components if needed
        }
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
        loadInventory 
    };
};