// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BossEncounterPicker from '../BossEncounterPicker';
import { bossShip } from '../../../constants/bountyBosses';
import type { BoardState } from '../PlacementBoard';

const trigger = () => screen.getByRole('button', { name: /encounter/i });

describe('BossEncounterPicker', () => {
    it('offers None and Fenri, and selecting Fenri puts him at his anchor', () => {
        const onChange = vi.fn();
        render(<BossEncounterPicker board={{}} onChange={onChange} />);
        fireEvent.click(trigger());
        expect(screen.getByRole('option', { name: 'None' })).toBeTruthy();
        fireEvent.click(screen.getByRole('option', { name: 'Fenri Khaliriz — Lv 32' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        const board = onChange.mock.calls[0][0] as BoardState;
        expect(Object.keys(board)).toEqual(['M1']);
        expect(board.M1?.ship.id).toBe('boss:fenri:32');
    });

    it('derives its value from a boss on the board and None clears the board', () => {
        const onChange = vi.fn();
        const board: BoardState = { M1: { ship: bossShip('fenri', 32)! } };
        render(<BossEncounterPicker board={board} onChange={onChange} />);
        expect(trigger().textContent).toContain('Fenri');
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: 'None' }));
        expect(onChange).toHaveBeenCalledWith({});
    });
});
