import { useCallback } from 'react';
import { Loadout, TeamLoadout } from '../types/loadout';
import { GearSlotName } from '../constants';
import { useStorage } from './useStorage';
import { useNotification } from './useNotification';
import { STORAGE_KEYS } from '../constants/storage';

const LOADOUTS_STORAGE_KEY = STORAGE_KEYS.SHIP_LOADOUTS;
const TEAM_LOADOUTS_STORAGE_KEY = STORAGE_KEYS.TEAM_LOADOUTS;

export const useLoadouts = () => {
    const { addNotification } = useNotification();
    const { data: loadouts = [], setData: setLoadouts } = useStorage<Loadout[]>({
        key: LOADOUTS_STORAGE_KEY,
        defaultValue: [],
    });

    const { data: teamLoadouts = [], setData: setTeamLoadouts } = useStorage<TeamLoadout[]>({
        key: TEAM_LOADOUTS_STORAGE_KEY,
        defaultValue: [],
    });

    const addLoadout = useCallback(
        async (loadout: Omit<Loadout, 'id' | 'createdAt'>) => {
            const newLoadout: Loadout = {
                ...loadout,
                id: crypto.randomUUID(),
                createdAt: Date.now(),
            };
            await setLoadouts([...loadouts, newLoadout]);
            addNotification('success', 'Loadout added');
        },
        [loadouts, setLoadouts, addNotification]
    );

    const updateLoadout = useCallback(
        async (id: string, equipment: Record<GearSlotName, string>) => {
            const newLoadouts = loadouts.map((loadout) =>
                loadout.id === id ? { ...loadout, equipment } : loadout
            );
            await setLoadouts(newLoadouts);
            addNotification('success', 'Loadout updated');
        },
        [loadouts, setLoadouts, addNotification]
    );

    const deleteLoadout = useCallback(
        async (id: string) => {
            await setLoadouts(loadouts.filter((loadout) => loadout.id !== id));
            addNotification('success', 'Loadout deleted');
        },
        [loadouts, setLoadouts, addNotification]
    );

    const validateTeamLoadout = useCallback((shipLoadouts: TeamLoadout['shipLoadouts']) => {
        const usedGear = new Set<string>();

        for (const loadout of shipLoadouts) {
            for (const gearId of Object.values(loadout.equipment)) {
                if (usedGear.has(gearId)) {
                    return false;
                }
                usedGear.add(gearId);
            }
        }

        return true;
    }, []);

    const addTeamLoadout = useCallback(
        async (teamLoadout: Omit<TeamLoadout, 'id' | 'createdAt'>) => {
            if (!validateTeamLoadout(teamLoadout.shipLoadouts)) {
                throw new Error('Invalid team loadout: Duplicate gear pieces detected');
            }

            const newTeamLoadout: TeamLoadout = {
                ...teamLoadout,
                id: crypto.randomUUID(),
                createdAt: Date.now(),
            };
            await setTeamLoadouts([...teamLoadouts, newTeamLoadout]);
            addNotification('success', 'Team loadout added');
        },
        [teamLoadouts, setTeamLoadouts, validateTeamLoadout, addNotification]
    );

    const updateTeamLoadout = useCallback(
        async (id: string, shipLoadouts: TeamLoadout['shipLoadouts']) => {
            if (!validateTeamLoadout(shipLoadouts)) {
                throw new Error('Invalid team loadout: Duplicate gear pieces detected');
            }

            const newTeamLoadouts = teamLoadouts.map((loadout) =>
                loadout.id === id ? { ...loadout, shipLoadouts } : loadout
            );
            await setTeamLoadouts(newTeamLoadouts);
            addNotification('success', 'Team loadout updated');
        },
        [teamLoadouts, setTeamLoadouts, validateTeamLoadout, addNotification]
    );

    const deleteTeamLoadout = useCallback(
        async (id: string) => {
            await setTeamLoadouts(teamLoadouts.filter((loadout) => loadout.id !== id));
            addNotification('success', 'Team loadout deleted');
        },
        [teamLoadouts, setTeamLoadouts, addNotification]
    );

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
