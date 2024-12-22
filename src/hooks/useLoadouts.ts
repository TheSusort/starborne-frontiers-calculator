import { useState, useEffect } from 'react';
import { Loadout, TeamLoadout } from '../types/loadout';
import { GearSlotName } from '../constants';

const LOADOUTS_STORAGE_KEY = 'shipLoadouts';
const TEAM_LOADOUTS_STORAGE_KEY = 'teamLoadouts';

export const useLoadouts = () => {
    const [loadouts, setLoadouts] = useState<Loadout[]>([]);
    const [teamLoadouts, setTeamLoadouts] = useState<TeamLoadout[]>([]);

    useEffect(() => {
        const saved = localStorage.getItem(LOADOUTS_STORAGE_KEY);
        if (saved) {
            setLoadouts(JSON.parse(saved));
        }
    }, []);

    const saveLoadouts = (newLoadouts: Loadout[]) => {
        localStorage.setItem(LOADOUTS_STORAGE_KEY, JSON.stringify(newLoadouts));
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

    // Load team loadouts
    useEffect(() => {
        const saved = localStorage.getItem(TEAM_LOADOUTS_STORAGE_KEY);
        if (saved) {
            setTeamLoadouts(JSON.parse(saved));
        }
    }, []);

    const saveTeamLoadouts = (newTeamLoadouts: TeamLoadout[]) => {
        localStorage.setItem(TEAM_LOADOUTS_STORAGE_KEY, JSON.stringify(newTeamLoadouts));
        setTeamLoadouts(newTeamLoadouts);
    };

    const validateTeamLoadout = (shipLoadouts: TeamLoadout['shipLoadouts']) => {
        const usedGear = new Set<string>();
        
        for (const loadout of shipLoadouts) {
            for (const gearId of Object.values(loadout.equipment)) {
                if (usedGear.has(gearId)) {
                    return false; // Gear piece is already used
                }
                usedGear.add(gearId);
            }
        }
        
        return true;
    };

    const addTeamLoadout = (teamLoadout: Omit<TeamLoadout, 'id' | 'createdAt'>) => {
        if (!validateTeamLoadout(teamLoadout.shipLoadouts)) {
            throw new Error('Invalid team loadout: Duplicate gear pieces detected');
        }

        const newTeamLoadout: TeamLoadout = {
            ...teamLoadout,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
        };
        saveTeamLoadouts([...teamLoadouts, newTeamLoadout]);
    };

    const updateTeamLoadout = (
        id: string, 
        shipLoadouts: TeamLoadout['shipLoadouts']
    ) => {
        if (!validateTeamLoadout(shipLoadouts)) {
            throw new Error('Invalid team loadout: Duplicate gear pieces detected');
        }

        const newTeamLoadouts = teamLoadouts.map(loadout => 
            loadout.id === id ? { ...loadout, shipLoadouts } : loadout
        );
        saveTeamLoadouts(newTeamLoadouts);
    };

    const deleteTeamLoadout = (id: string) => {
        saveTeamLoadouts(teamLoadouts.filter(loadout => loadout.id !== id));
    };

    return {
        loadouts,
        addLoadout,
        updateLoadout,
        deleteLoadout,
        teamLoadouts,
        addTeamLoadout,
        updateTeamLoadout,
        deleteTeamLoadout,
    };
}; 