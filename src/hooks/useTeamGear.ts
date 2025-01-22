import { useMemo } from 'react';
import { TeamLoadout } from '../types/loadout';
import { calculateGearSets } from '../utils/gear/gearSetCalculator';
import { GearPiece } from '../types/gear';

export const useTeamGearLookup = (
    shipLoadouts: TeamLoadout['shipLoadouts'],
    getGearPiece: (id: string) => GearPiece
) => {
    return useMemo(() => {
        const lookups: Record<number, Record<string, GearPiece>> = {};

        shipLoadouts.forEach((loadout) => {
            const gearLookup: Record<string, GearPiece> = {};
            Object.values(loadout.equipment).forEach((gearId) => {
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
    gearLookups: Record<number, Record<string, GearPiece>>
) => {
    return useMemo(() => {
        const sets: Record<number, string[]> = {};

        shipLoadouts.forEach((loadout) => {
            const gearLookup = gearLookups[loadout.position];
            const equippedGear = Object.values(loadout.equipment)
                .map((gearId) => gearLookup[gearId])
                .filter(Boolean);

            sets[loadout.position] = calculateGearSets(equippedGear);
        });

        return sets;
    }, [shipLoadouts, gearLookups]);
};
