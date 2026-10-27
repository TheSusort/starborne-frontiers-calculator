import { describe, expect, it } from 'vitest';
import type { Position } from '../../../types/encounters';
import { ALL_POSITIONS, SMALL_GRID_POSITIONS } from '../../targeting/board';
import { fitBoardToCells, fitNotice, gridCells } from '../gridMode';

type Board = Partial<Record<Position, string>>;

describe('gridCells', () => {
    it('normal is the full board, small the seven-cell grid', () => {
        expect(gridCells('normal')).toBe(ALL_POSITIONS);
        expect(gridCells('small')).toBe(SMALL_GRID_POSITIONS);
    });
});

describe('fitBoardToCells', () => {
    it('leaves a board already on the grid as the same object', () => {
        const board: Board = { M3: 'a', T2: 'b' };
        const fitted = fitBoardToCells(board, SMALL_GRID_POSITIONS);
        expect(fitted.board).toBe(board);
        expect(fitted).toMatchObject({ moved: 0, dropped: 0 });
    });

    it('moves an outside ship to the nearest free cell and keeps the ones inside put', () => {
        // T1's free neighbour is M2. B4 neighbours both M4 and B3, and stays in its row.
        const board: Board = { T1: 'x', T2: 'b', B4: 'y' };
        const fitted = fitBoardToCells(board, SMALL_GRID_POSITIONS);
        expect(fitted.board).toEqual({ T2: 'b', M2: 'x', B3: 'y' });
        expect(fitted).toMatchObject({ moved: 2, dropped: 0 });
    });

    it('carries the placement itself, overrides included', () => {
        const placement = { ship: 'Nova', overrides: { attack: 9000 } };
        const fitted = fitBoardToCells({ M1: placement }, SMALL_GRID_POSITIONS);
        expect(fitted.board.M2).toBe(placement);
    });

    it('drops what does not fit once every small-grid cell is taken', () => {
        const board: Board = Object.fromEntries(ALL_POSITIONS.map((p) => [p, p]));
        const fitted = fitBoardToCells(board, SMALL_GRID_POSITIONS);
        expect(Object.keys(fitted.board).sort()).toEqual([...SMALL_GRID_POSITIONS].sort());
        expect(fitted).toMatchObject({ moved: 0, dropped: 5 });
    });

    it('fills free cells before dropping', () => {
        const board: Board = { T1: '1', T4: '2', M1: '3', B1: '4', B4: '5', M3: '6' };
        const fitted = fitBoardToCells(board, SMALL_GRID_POSITIONS);
        expect(Object.keys(fitted.board)).toHaveLength(6);
        expect(
            Object.keys(fitted.board).every((p) => SMALL_GRID_POSITIONS.includes(p as Position))
        ).toBe(true);
        expect(fitted).toMatchObject({ moved: 5, dropped: 0 });
    });
});

describe('fitNotice', () => {
    it('says nothing when nothing moved', () => {
        expect(fitNotice(0, 0)).toBeNull();
    });
    it('names moves and drops', () => {
        expect(fitNotice(1, 0)).toBe('1 ship moved onto the small grid.');
        expect(fitNotice(2, 1)).toBe(
            '2 ships moved onto the small grid; 1 ship did not fit on the small grid and was left out.'
        );
    });
});
