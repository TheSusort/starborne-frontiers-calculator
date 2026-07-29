import { Ship } from '../../types/ship';

/**
 * Removes duplicate ship IDs, keeping the first occurrence. Order is the
 * gear-pick order, so the earliest mention is the one worth keeping — and the
 * same ship queued twice is only wasted optimisation work.
 */
export const dedupeShipIds = (shipIds: string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const id of shipIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }

    return result;
};

export interface ResolvedTeamShips {
    /** Live ships, in stored order. */
    ships: Ship[];
    /** How many stored IDs are no longer in the fleet (deleted or re-imported). */
    missingCount: number;
}

/**
 * Resolves a saved team's ship IDs against the current fleet.
 *
 * Teams store raw IDs with no foreign key, because ship rows are replaced on
 * re-import. A partially resolvable team is normal and is loaded as far as it
 * goes; the caller decides how to report `missingCount`.
 */
export const resolveTeamShips = (
    shipIds: string[],
    getShipById: (id: string) => Ship | undefined
): ResolvedTeamShips => {
    const ships: Ship[] = [];
    let missingCount = 0;

    for (const id of dedupeShipIds(shipIds)) {
        const ship = getShipById(id);
        if (ship) {
            ships.push(ship);
        } else {
            missingCount++;
        }
    }

    return { ships, missingCount };
};

/**
 * True when both lists contain the same ship ids, ignoring order and duplicates.
 *
 * This is what keeps a loaded team's link alive across a reorder: reordering
 * preserves the set, while adding, removing or swapping a ship changes it. The
 * caller therefore never has to remember to clear the link — it simply stops
 * matching.
 */
export const isSameShipSet = (a: string[], b: string[]): boolean => {
    const setA = new Set(a);
    const setB = new Set(b);

    if (setA.size !== setB.size) return false;

    for (const id of setA) {
        if (!setB.has(id)) return false;
    }

    return true;
};
