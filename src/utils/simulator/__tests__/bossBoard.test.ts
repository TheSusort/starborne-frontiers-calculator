import { describe, it, expect } from 'vitest';
import { withoutStrayBossCells, encounterBoard, loadedBossShipId } from '../bossBoard';
import { resolveShipId } from '../../ship/resolveShipId';
import { serializeSetup, deserializeSetup } from '../simulatorSetup';
import { bossShip } from '../../../constants/bountyBosses';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Ship } from '../../../types/ship';

const boss = bossShip('fenri', 32)!;
const ally = { id: 'a', name: 'A' } as Ship;

describe('withoutStrayBossCells', () => {
    it('keeps a boss on its anchor and the same object when nothing is stray', () => {
        const board: BoardState = { M1: { ship: boss }, T1: { ship: ally } };
        expect(withoutStrayBossCells(board)).toBe(board);
    });

    it('drops a boss off its anchor and any ship on a boss secondary cell', () => {
        expect(withoutStrayBossCells({ T3: { ship: boss }, T1: { ship: ally } })).toEqual({
            T1: { ship: ally },
        });
        expect(
            Object.keys(withoutStrayBossCells({ M1: { ship: boss }, M2: { ship: ally } }))
        ).toEqual(['M1']);
    });
});

describe('encounterBoard', () => {
    it('places Mamma on her anchor and a Capo on each add cell', () => {
        const board = encounterBoard('maglienza', 32)!;
        expect(Object.keys(board).sort()).toEqual(['B2', 'M4', 'T1', 'T2']);
        expect(board.T1?.ship.id).toBe('boss:maglienza:32');
        for (const cell of ['T2', 'M4', 'B2'] as const) {
            expect(board[cell]?.ship.id).toBe('npc:capo:124');
        }
        expect(loadedBossShipId(board)).toBe('boss:maglienza:32');
    });

    it('is null for an unknown encounter', () => {
        expect(encounterBoard('maglienza', 99)).toBeNull();
    });

    it('keeps the adds through stray-cell cleanup and still drops a ship on her cells', () => {
        const board = encounterBoard('maglienza', 32)!;
        expect(withoutStrayBossCells(board)).toBe(board);
        const cleaned = withoutStrayBossCells({ ...board, M2: { ship: ally } });
        expect(Object.keys(cleaned).sort()).toEqual(['B2', 'M4', 'T1', 'T2']);
    });

    it('round-trips through a saved setup with overrides on the boss and an add', () => {
        const board = encounterBoard('maglienza', 32)!;
        board.T1 = { ...board.T1!, overrides: { hp: 1000 } };
        board.T2 = { ...board.T2!, overrides: { speed: 5 } };
        const setup = serializeSetup({
            name: 'x',
            playerBoard: {},
            enemyBoard: board,
            seed: 1,
            runCount: 1,
            gridMode: 'normal',
            savedAt: 0,
        });
        expect(setup.enemyBoard.T2?.shipId).toBe('npc:capo:124');
        const result = deserializeSetup(setup, (id) =>
            resolveShipId(id, {
                getShipById: () => undefined,
                units: [],
                getAscensionStats: () => null,
            })
        );
        expect(result.dropped).toEqual([]);
        expect(Object.keys(result.enemyBoard).sort()).toEqual(['B2', 'M4', 'T1', 'T2']);
        expect(result.enemyBoard.T1?.overrides).toEqual({ hp: 1000 });
        expect(result.enemyBoard.T2?.overrides).toEqual({ speed: 5 });
        expect(result.enemyBoard.M4?.ship.id).toBe('npc:capo:124');
    });
});
