import { useMemo } from 'react';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { GEAR_SETS } from '../constants/gearSets';

// Helper type for the gear lookup
export type GearLookup = Record<string, GearPiece | undefined>;

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
                const gear = getGearPiece(gearId);
                lookup[gearId] = gear;
            }
        });
        return lookup;
    }, [equipment, getGearPiece]);
};

/**
 * Calculates active gear set bonuses based on equipped gear
 * Returns an array of set names, with each name repeated for every complete set (2 pieces)
 */
export const useGearSets = (
    equipment: Partial<Record<string, string>>,
    gearLookup: GearLookup
): string[] => {
    return useMemo(() => {
        const setCount = Object.values(equipment).reduce(
            (acc, gearId) => {
                if (!gearId) return acc;
                const gear = gearLookup[gearId];
                if (!gear?.setBonus) return acc;

                acc[gear.setBonus] = (acc[gear.setBonus] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>
        );

        // For each set, add the set name multiple times based on complete sets
        return Object.entries(setCount).flatMap(([setName, count]) => {
            const completeSets = Math.floor(count / (GEAR_SETS[setName]?.minPieces || 2));
            return Array(completeSets).fill(setName);
        });
    }, [equipment, gearLookup]);
};

/**
 * Finds all pieces that are part of incomplete sets
 */
export function useOrphanSetPieces(ship: Ship, gearLookup: GearLookup): GearPiece[] {
    return useMemo(() => {
        // Count pieces per set
        const setCount: Record<string, number> = {};

        // Track pieces by their set for easy lookup later
        const piecesBySet: Record<string, GearPiece[]> = {};

        // Analyze each equipped piece
        Object.values(ship?.equipment || {}).forEach((gearId) => {
            if (!gearId) return;

            const gear = gearLookup[gearId];
            if (!gear?.setBonus) return;

            // Count the piece
            setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;

            // Store the piece reference
            if (!piecesBySet[gear.setBonus]) {
                piecesBySet[gear.setBonus] = [];
            }
            piecesBySet[gear.setBonus].push(gear);
        });

        // Find all pieces from incomplete sets (count < 2)
        return Object.entries(setCount)
            .filter(([_, count]) => count < 2)
            .flatMap(([setName]) => piecesBySet[setName] || []);
    }, [ship?.equipment, gearLookup]);
}
