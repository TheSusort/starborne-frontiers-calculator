import { Position } from '../../types/encounters';
import { ParsedTarget } from '../targetingParser';
import { BoardRow, rowOf, colOf } from './board';

export interface SelectTargetsContext {
    /** The acting actor's own cell — REQUIRED (drives the row scan). */
    casterPosition: Position;
    /** Living, targetable enemy cells in the acting side's own frame (<=1 actor per cell). */
    enemyOccupied: readonly Position[];
    /** Forward-looking (Phase-4 ally splash). UNUSED in Phase-2 selection. */
    allyOccupied?: readonly Position[];
}

export interface SelectionResult {
    /** Full ordered target list; head === anchor. */
    ordered: Position[];
    /** null when the requested side has no living target. */
    anchor: Position | null;
}

const ROWS: BoardRow[] = ['T', 'M', 'B'];

/** Row scan order: start at the caster's row, descend a row, wrap bottom->top. */
export function rowScanOrder(casterRow: BoardRow): BoardRow[] {
    const i = ROWS.indexOf(casterRow);
    return [ROWS[i], ROWS[(i + 1) % 3], ROWS[(i + 2) % 3]];
}

/** Occupied cells of `row`, sorted front->back (column 4 first). */
function colsFrontToBack(row: BoardRow, occupied: readonly Position[]): Position[] {
    return occupied.filter((p) => rowOf(p) === row).sort((a, b) => colOf(b) - colOf(a));
}

export function selectTargets(target: ParsedTarget, ctx: SelectTargetsContext): SelectionResult {
    // Ally side: support patterns anchor on the caster's own cell.
    if (target.side === 'ally') {
        return { ordered: [ctx.casterPosition], anchor: ctx.casterPosition };
    }

    // Enemy side.
    if (ctx.enemyOccupied.length === 0) {
        return { ordered: [], anchor: null };
    }

    const scan = rowScanOrder(rowOf(ctx.casterPosition));

    // `all`: every living enemy, row-scan order then front->back within each row.
    if (target.selection === 'all') {
        const ordered = scan.flatMap((row) => colsFrontToBack(row, ctx.enemyOccupied));
        return { ordered, anchor: ordered[0] };
    }

    // front/back/skip: first row in scan order with >=1 enemy.
    const targetRow = scan.find((row) => ctx.enemyOccupied.some((p) => rowOf(p) === row))!;
    const cols = colsFrontToBack(targetRow, ctx.enemyOccupied); // front->back

    let ordered: Position[];
    switch (target.selection) {
        case 'back':
            ordered = [...cols].reverse();
            break;
        case 'skip':
            // 2nd-from-front anchor; continue toward the back, skipped front-most goes last.
            // length 1 -> degrades to [cols[0]] (== front).
            ordered = cols.length === 1 ? cols : [...cols.slice(1), cols[0]];
            break;
        case 'front':
        default:
            ordered = cols;
            break;
    }
    return { ordered, anchor: ordered[0] };
}
