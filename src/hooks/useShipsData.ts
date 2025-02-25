import { useState, useEffect } from 'react';
import { shipsService } from '../services/firebase/ships';
import { Ship } from '../types/ship';

export const useShipsData = () => {
    const [ships, setShips] = useState<Ship[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchShips = async () => {
            try {
                const shipsData = await shipsService.getAllShips();

                setShips(shipsData);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch ships data');
            } finally {
                setLoading(false);
            }
        };

        fetchShips();
    }, []);

    return { ships, loading, error };
};
