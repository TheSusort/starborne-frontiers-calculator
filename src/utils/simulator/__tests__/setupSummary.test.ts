import { describe, it, expect } from 'vitest';
import type { Ship } from '../../../types/ship';
import { bossShip } from '../../../constants/bountyBosses';
import { groupLabels, setupChipLabels } from '../setupSummary';
import type { BoardState } from '../../../components/simulator/PlacementBoard';

const ship = (id: string, name: string) => ({ id, name }) as unknown as Ship;

describe('groupLabels', () => {
    it('keeps first-appearance order and groups repeats as "Name ×N"', () => {
        expect(groupLabels(['Capo', 'Nova', 'Capo', 'Capo'])).toEqual(['Capo ×3', 'Nova']);
    });

    it('leaves a single name bare', () => {
        expect(groupLabels(['Nova'])).toEqual(['Nova']);
    });
});

describe('setupChipLabels', () => {
    it('groups duplicate ships on a board', () => {
        const board: BoardState = {
            T1: { ship: ship('a', 'Capo') },
            T2: { ship: ship('b', 'Capo') },
            M1: { ship: ship('c', 'Nova') },
        };
        expect(setupChipLabels(board)).toEqual(['Capo ×2', 'Nova']);
    });

    it('names a boss with its level', () => {
        const boss = bossShip('fenri', 32)!;
        expect(setupChipLabels({ M1: { ship: boss } })).toEqual(['Fenri Khaliriz Lv 32']);
    });
});
