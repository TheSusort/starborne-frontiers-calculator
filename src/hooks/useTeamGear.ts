import { useMemo } from 'react';
import { TeamLoadout } from '../types/loadout';
import { calculateGearSets } from '../utils/gearSetCalculator';

export const useTeamGearLookup = (
    shipLoadouts: TeamLoadout['shipLoadouts'],
    getGearPiece: (id: string) => any
) => {
    return useMemo(() => {
        const lookups: Record<number, Record<string, any>> = {};

        shipLoadouts.forEach(loadout => {
            const gearLookup: Record<string, any> = {};
            Object.values(loadout.equipment).forEach(gearId => {
                if (gearId && !gearLookup[gearId]) {
                    gearLookup[gearId] = getGearPiece(gearId);
                }
            });
            lookups[loadout.position] = gearLookup;
        });

        return lookups;
    }, [shipLoadouts, getGearPiece]);
};

export const useTeamGearSets = (
    shipLoadouts: TeamLoadout['shipLoadouts'],
    gearLookups: Record<number, Record<string, any>>
) => {
    return useMemo(() => {
        const sets: Record<number, string[]> = {};

        shipLoadouts.forEach(loadout => {
            const gearLookup = gearLookups[loadout.position];
            const equippedGear = Object.values(loadout.equipment)
                .map(gearId => gearLookup[gearId])
                .filter(Boolean);

            sets[loadout.position] = calculateGearSets(equippedGear);
        });

        return sets;
    }, [shipLoadouts, gearLookups]);
};