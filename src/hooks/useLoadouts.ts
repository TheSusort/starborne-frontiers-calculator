import { useState, useEffect } from 'react';
import { Loadout, TeamLoadout } from '../types/loadout';
import { GearSlotName } from '../constants';
import { useNotification } from './useNotification';

const LOADOUTS_STORAGE_KEY = 'shipLoadouts';
const TEAM_LOADOUTS_STORAGE_KEY = 'teamLoadouts';

export const useLoadouts = () => {
    const [loadouts, setLoadouts] = useState<Loadout[]>([]);
    const [teamLoadouts, setTeamLoadouts] = useState<TeamLoadout[]>([]);
    const { addNotification } = useNotification();
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

    const addLoadout = async (loadout: Omit<Loadout, 'id' | 'createdAt'>) => {
        const newLoadout: Loadout = {
            ...loadout,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
        };
        await saveLoadouts([...loadouts, newLoadout]);
        addNotification('success', 'Loadout added');
    };

    const updateLoadout = async (id: string, equipment: Record<GearSlotName, string>) => {
        const newLoadouts = loadouts.map((loadout) =>
            loadout.id === id ? { ...loadout, equipment } : loadout
        );
        await saveLoadouts(newLoadouts);
        addNotification('success', 'Loadout updated');
    };

    const deleteLoadout = async (id: string) => {
        await saveLoadouts(loadouts.filter((loadout) => loadout.id !== id));
        addNotification('success', 'Loadout deleted');
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
        addNotification('success', 'Team loadout updated');
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

    const addTeamLoadout = async (teamLoadout: Omit<TeamLoadout, 'id' | 'createdAt'>) => {
        if (!validateTeamLoadout(teamLoadout.shipLoadouts)) {
            throw new Error('Invalid team loadout: Duplicate gear pieces detected');
        }

        const newTeamLoadout: TeamLoadout = {
            ...teamLoadout,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
        };
        await saveTeamLoadouts([...teamLoadouts, newTeamLoadout]);
        addNotification('success', 'Team loadout added');
    };

    const updateTeamLoadout = async (id: string, shipLoadouts: TeamLoadout['shipLoadouts']) => {
        if (!validateTeamLoadout(shipLoadouts)) {
            throw new Error('Invalid team loadout: Duplicate gear pieces detected');
        }

        const newTeamLoadouts = teamLoadouts.map((loadout) =>
            loadout.id === id ? { ...loadout, shipLoadouts } : loadout
        );
        await saveTeamLoadouts(newTeamLoadouts);
        addNotification('success', 'Team loadout updated');
    };

    const deleteTeamLoadout = async (id: string) => {
        await saveTeamLoadouts(teamLoadouts.filter((loadout) => loadout.id !== id));
        addNotification('success', 'Team loadout deleted');
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
