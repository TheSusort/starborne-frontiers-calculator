import type { Position } from '../../types/encounters';
import type { TargetSelection } from '../targetingParser';
import { colOf, rowOf } from '../targeting/board';
import { rowScanOrder } from '../targeting/selectTargets';

/** The board-placement slice of an actor: its anchor cell and, for a multi-hex unit (a bounty
 *  boss), every cell it occupies. */
export interface CellOccupant {
    position?: Position;
    /** Every occupied cell, anchor first. Absent → the unit occupies its anchor `position` only. */
    footprint?: readonly Position[];
}

/** Every cell a unit occupies: its footprint, else its anchor, else none. */
export const cellsOf = (a: CellOccupant): readonly Position[] =>
    a.footprint ?? (a.position !== undefined ? [a.position] : []);

/**
 * Cell → unit index over every cell each actor occupies. A multi-hex unit appears under each of
 * its cells, so a caller that walks cells and collects units must dedupe by unit (a pattern
 * covering several of a boss's hexes hits it once).
 */
export function buildCellIndex<T extends CellOccupant>(actors: readonly T[]): Map<Position, T> {
    const byCell = new Map<Position, T>();
    for (const a of actors) {
        for (const cell of cellsOf(a)) byCell.set(cell, a);
    }
    return byCell;
}

/** Front-most first (column 4 = front). */
const frontToBack = (cells: readonly Position[]): Position[] =>
    [...cells].sort((a, b) => colOf(b) - colOf(a));

/**
 * The cell an attacker hits on a unit it has already chosen: the first row of the attacker's row
 * scan the unit occupies, then its back-most cell there for a `back` target and its front-most
 * cell otherwise. For a single-hex unit this is its own cell. `selectTargets`' anchor over the
 * same cells agrees with it whenever the unit is the one normal selection picks.
 */
export function hitCellOf(
    unit: CellOccupant,
    casterPosition: Position,
    selection: TargetSelection
): Position | undefined {
    const cells = cellsOf(unit);
    if (cells.length <= 1) return cells[0];
    const row = rowScanOrder(rowOf(casterPosition)).find((r) => cells.some((c) => rowOf(c) === r));
    const inRow = frontToBack(cells.filter((c) => rowOf(c) === row));
    return selection === 'back' ? inRow[inRow.length - 1] : inRow[0];
}

/**
 * Each unit's cells collapsed to one per row — its back-most cell there for a `back` target, its
 * front-most otherwise — so a cell-level selection (`selectTargets`) counts a multi-hex unit once
 * per row: `skip` must pass over a whole unit, not over one of its hexes.
 */
export function representativeCells<T extends CellOccupant>(
    units: readonly T[],
    selection: TargetSelection
): Position[] {
    const out: Position[] = [];
    for (const unit of units) {
        const byRow = new Map<string, Position[]>();
        for (const cell of cellsOf(unit)) {
            const row = rowOf(cell);
            byRow.set(row, [...(byRow.get(row) ?? []), cell]);
        }
        for (const rowCells of byRow.values()) {
            const ordered = frontToBack(rowCells);
            out.push(selection === 'back' ? ordered[ordered.length - 1] : ordered[0]);
        }
    }
    return out;
}
