import { Position, ShipPosition } from '../../types/encounters';

/**
 * Board reading order, mirroring the `rows` array in
 * src/components/encounters/FormationGrid.tsx.
 */
const POSITION_ORDER: Position[] = [
    'T1',
    'T2',
    'T3',
    'T4',
    'M1',
    'M2',
    'M3',
    'M4',
    'B1',
    'B2',
    'B3',
    'B4',
];

/** The entry's explicit turn order, or null when the user never assigned one. */
const explicitOrder = (entry: ShipPosition): number | null =>
    typeof entry.sortOrder === 'number' ? entry.sortOrder : null;

const positionRank = (position: Position): number => {
    const index = POSITION_ORDER.indexOf(position);
    return index === -1 ? POSITION_ORDER.length : index;
};

/**
 * Derives the ordered Autogear ship queue from an encounter formation.
 *
 * Order matters: index 0 gets first pick of the gear inventory. Entries with an
 * explicit sortOrder come first (ascending) because that is the order the user
 * deliberately assigned; the rest follow in board reading order. Duplicate ship
 * IDs collapse to their first occurrence.
 */
export const formationToShipIds = (formation: ShipPosition[]): string[] => {
    const sorted = [...formation].sort((a, b) => {
        const aOrder = explicitOrder(a);
        const bOrder = explicitOrder(b);

        if (aOrder !== null && bOrder !== null) return aOrder - bOrder;
        if (aOrder !== null) return -1;
        if (bOrder !== null) return 1;

        return positionRank(a.position) - positionRank(b.position);
    });

    const seen = new Set<string>();
    const shipIds: string[] = [];

    for (const entry of sorted) {
        if (seen.has(entry.shipId)) continue;
        seen.add(entry.shipId);
        shipIds.push(entry.shipId);
    }

    return shipIds;
};
