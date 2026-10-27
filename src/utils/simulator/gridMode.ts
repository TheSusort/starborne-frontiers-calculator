import type { Position } from '../../types/encounters';
import { ALL_POSITIONS, positionToAxial, SMALL_GRID_POSITIONS } from '../targeting/board';

/** Which cells a simulator setup places ships on: the full 12-cell board or the 7-cell small
 *  grid (M3 and its neighbours). Both sides always use the same grid. */
export type GridMode = 'normal' | 'small';

export const GRID_MODES = ['normal', 'small'] as const satisfies readonly GridMode[];

export const DEFAULT_GRID_MODE: GridMode = 'normal';

export const gridCells = (mode: GridMode): readonly Position[] =>
    mode === 'small' ? SMALL_GRID_POSITIONS : ALL_POSITIONS;

const hexDistance = (a: Position, b: Position) => {
    const p = positionToAxial(a);
    const q = positionToAxial(b);
    const dq = p.q - q.q;
    const dr = p.r - q.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};

export interface FittedBoard<T> {
    board: Partial<Record<Position, T>>;
    /** Placements moved from a cell outside `cells` onto a free one. */
    moved: number;
    /** Placements outside `cells` that found no free cell, left off the board. */
    dropped: number;
}

/**
 * `board` with every placement on a cell of `cells`. A placement already on one stays put; one
 * outside moves, with whatever it carries, to the nearest free cell (hex distance; among equally
 * near cells one in its own row, then the first in `cells`), taking the outside placements in
 * `ALL_POSITIONS` order. Once `cells` is full the rest are dropped. A board already inside
 * `cells` comes back as the same object.
 */
export function fitBoardToCells<T>(
    board: Partial<Record<Position, T>>,
    cells: readonly Position[]
): FittedBoard<T> {
    const allowed = new Set(cells);
    const outside = ALL_POSITIONS.filter((p) => board[p] !== undefined && !allowed.has(p));
    if (outside.length === 0) return { board, moved: 0, dropped: 0 };
    const next: Partial<Record<Position, T>> = {};
    for (const p of cells) if (board[p] !== undefined) next[p] = board[p];
    let moved = 0;
    let dropped = 0;
    for (const from of outside) {
        const free = cells.filter((c) => next[c] === undefined);
        if (free.length === 0) {
            dropped++;
            continue;
        }
        const cost = (c: Position) => 2 * hexDistance(from, c) + (c[0] === from[0] ? 0 : 1);
        let best = free[0];
        for (const c of free) if (cost(c) < cost(best)) best = c;
        next[best] = board[from];
        moved++;
    }
    return { board: next, moved, dropped };
}

/** The sentence telling the player what fitting did, or `null` when it did nothing. */
export function fitNotice(moved: number, dropped: number): string | null {
    const parts: string[] = [];
    if (moved > 0) parts.push(`${moved} ship${moved === 1 ? '' : 's'} moved onto the small grid`);
    if (dropped > 0)
        parts.push(
            `${dropped} ship${dropped === 1 ? '' : 's'} did not fit on the small grid and ${dropped === 1 ? 'was' : 'were'} left out`
        );
    return parts.length > 0 ? `${parts.join('; ')}.` : null;
}
