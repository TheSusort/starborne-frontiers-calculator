import { useMemo } from 'react';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';

// Helper type for the gear lookup
type GearLookup = Record<string, GearPiece | undefined>;

/**
 * Creates a memoized lookup object for gear pieces based on equipment IDs
 */
export const useGearLookup = (
    equipment: Ship['equipment'],
    getGearPiece: (id: string) => GearPiece | undefined
): GearLookup => {
    return useMemo(() => {
        const lookup: GearLookup = {};
        Object.entries(equipment).forEach(([_, gearId]) => {
            if (gearId) {
                lookup[gearId] = getGearPiece(gearId);
            }
        });
        return lookup;
    }, [equipment, getGearPiece]);
};

/**
 * Calculates active gear set bonuses based on equipped gear
 * Returns an array of set names that have 2 or more pieces equipped
 */
export const useGearSets = (
    equipment: Ship['equipment'],
    gearLookup: GearLookup
): string[] => {
    return useMemo(() => {
        const setCount = Object.values(equipment).reduce((acc, gearId) => {
            if (!gearId) return acc;
            const gear = gearLookup[gearId];
            if (!gear?.setBonus) return acc;

            acc[gear.setBonus] = (acc[gear.setBonus] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return Object.entries(setCount)
            .filter(([_, count]) => count >= 2)
            .map(([setName]) => setName);
    }, [equipment, gearLookup]);
};