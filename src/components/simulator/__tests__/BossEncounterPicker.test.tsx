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

    it('selecting Mamma loads the boss and all three Capos', () => {
        const onChange = vi.fn();
        render(<BossEncounterPicker board={{}} onChange={onChange} />);
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: 'Mamma Maglienza — Lv 32' }));
        const board = onChange.mock.calls[0][0] as BoardState;
        expect(Object.keys(board).sort()).toEqual(['B2', 'M4', 'T1', 'T2']);
        expect(board.T1?.ship.id).toBe('boss:maglienza:32');
        expect(board.T2?.ship.id).toBe('npc:capo:124');
    });

    it('selecting Colosso loads him anchored at T3 with three Major Grands', () => {
        const onChange = vi.fn();
        render(<BossEncounterPicker board={{}} onChange={onChange} />);
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: 'General Colosso — Lv 32' }));
        const board = onChange.mock.calls[0][0] as BoardState;
        expect(Object.keys(board).sort()).toEqual(['B1', 'M2', 'T1', 'T3']);
        expect(board.T3?.ship.id).toBe('boss:colosso:32');
        expect(board.T1?.ship.id).toBe('npc:major-grand:124');
        expect(board.M2?.ship.id).toBe('npc:major-grand:124');
        expect(board.B1?.ship.id).toBe('npc:major-grand:124');
    });
});
