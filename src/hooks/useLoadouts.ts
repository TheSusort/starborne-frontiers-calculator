import { useState, useEffect } from 'react';
import { Loadout } from '../types/loadout';
import { GearSlotName } from '../constants';

const STORAGE_KEY = 'shipLoadouts';

export const useLoadouts = () => {
    const [loadouts, setLoadouts] = useState<Loadout[]>([]);

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            setLoadouts(JSON.parse(saved));
        }
    }, []);

    const saveLoadouts = (newLoadouts: Loadout[]) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newLoadouts));
        setLoadouts(newLoadouts);
    };

    const addLoadout = (loadout: Omit<Loadout, 'id' | 'createdAt'>) => {
        const newLoadout: Loadout = {
            ...loadout,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
        };
        saveLoadouts([...loadouts, newLoadout]);
    };

    const updateLoadout = (id: string, equipment: Record<GearSlotName, string>) => {
        const newLoadouts = loadouts.map(loadout => 
            loadout.id === id ? { ...loadout, equipment } : loadout
        );
        saveLoadouts(newLoadouts);
    };

    const deleteLoadout = (id: string) => {
        saveLoadouts(loadouts.filter(loadout => loadout.id !== id));
    };

    return {
        loadouts,
        addLoadout,
        updateLoadout,
        deleteLoadout,
    };
}; 