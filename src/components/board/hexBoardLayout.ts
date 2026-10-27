import type { Position } from '../../types/encounters';
import { positionToAxial } from '../../utils/targeting/board';

export interface CellBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** A pointy-top hex's height over its width. */
const HEX_HEIGHT = 2 / Math.sqrt(3);

/**
 * Each cell's box, in percent of the board, and the board's width over its height. Centres follow
 * `hexGeometry`'s pointy-top layout of `board.ts` axial coordinates: `q + r/2` hex widths across
 * (+q is the front) and `0.75` hex heights per row down, so the middle row sits half a hex toward
 * the back. Mirrored, the front points left.
 */
export function hexBoardLayout(cells: readonly Position[]) {
    const centres = new Map(
        cells.map((cell) => {
            const { q, r } = positionToAxial(cell);
            return [cell, { x: q + r / 2, y: r * 0.75 * HEX_HEIGHT }] as const;
        })
    );
    const xs = [...centres.values()].map((c) => c.x);
    const ys = [...centres.values()].map((c) => c.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX + 1;
    const height = Math.max(...ys) - minY + HEX_HEIGHT;
    const box = (cell: Position, mirrored: boolean): CellBox => {
        const c = centres.get(cell);
        if (!c) throw new Error(`hexBoardLayout: ${cell} is not on this board`);
        const left = mirrored ? width - (c.x - minX) - 1 : c.x - minX;
        return {
            left: (100 * left) / width,
            top: (100 * (c.y - minY)) / height,
            width: 100 / width,
            height: (100 * HEX_HEIGHT) / height,
        };
    };
    return { aspectRatio: width / height, box };
}
