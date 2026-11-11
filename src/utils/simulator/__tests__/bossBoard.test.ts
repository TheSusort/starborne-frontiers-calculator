import { describe, it, expect } from 'vitest';
import { withoutStrayBossCells } from '../bossBoard';
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
