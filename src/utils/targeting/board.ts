import { Position } from '../../types/encounters';

export interface Axial {
    q: number;
    r: number;
}

/** Axial coordinates for the 12 board cells. Chosen so the 6 hex directions below
 *  reproduce the in-game adjacency (M2 ↔ T1,T2,M1,M3,B1,B2) with column 4 = front
 *  and the M row offset half a hex toward the back. Depth toward back = (-1, 0). */
const AXIAL: Record<Position, Axial> = {
    T1: { q: 0, r: 0 },
    T2: { q: 1, r: 0 },
    T3: { q: 2, r: 0 },
    T4: { q: 3, r: 0 },
    M1: { q: -1, r: 1 },
    M2: { q: 0, r: 1 },
    M3: { q: 1, r: 1 },
    M4: { q: 2, r: 1 },
    B1: { q: -1, r: 2 },
    B2: { q: 0, r: 2 },
    B3: { q: 1, r: 2 },
    B4: { q: 2, r: 2 },
};

export const ALL_POSITIONS = Object.keys(AXIAL) as Position[];

const AXIAL_TO_POS = new Map<string, Position>(
    ALL_POSITIONS.map((p) => [`${AXIAL[p].q},${AXIAL[p].r}`, p])
);

/** The 6 hex neighbor directions (Δq, Δr). See the plan's direction table for meaning. */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [-1, 0], // back
    [1, 0], // front
    [0, -1], // up-back
    [1, -1], // up-front
    [-1, 1], // down-back
    [0, 1], // down-front
];

export function positionToAxial(pos: Position): Axial {
    return AXIAL[pos];
}

export function axialToPosition(q: number, r: number): Position | undefined {
    return AXIAL_TO_POS.get(`${q},${r}`);
}

export function inBoundsAxial(q: number, r: number): boolean {
    return AXIAL_TO_POS.has(`${q},${r}`);
}

export function neighbors(pos: Position): Position[] {
    const { q, r } = AXIAL[pos];
    const out: Position[] = [];
    for (const [dq, dr] of DIRECTIONS) {
        const n = axialToPosition(q + dq, r + dr);
        if (n) out.push(n);
    }
    return out;
}
