// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BossEncounterPicker from '../BossEncounterPicker';
import { bossShip } from '../../../constants/bountyBosses';
import { encounterBoard } from '../../../utils/simulator/bossBoard';
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

    it('lists both Fenri levels as separate options', () => {
        render(<BossEncounterPicker board={{}} onChange={vi.fn()} />);
        fireEvent.click(trigger());
        expect(screen.getByRole('option', { name: 'Fenri Khaliriz — Lv 32' })).toBeTruthy();
        expect(screen.getByRole('option', { name: 'Abyssal Fenri Khaliriz — Lv 33' })).toBeTruthy();
    });

    it('shows Abyssal Fenri as selected when his encounter is loaded', () => {
        const board = encounterBoard('fenri', 33)!;
        render(<BossEncounterPicker board={board} onChange={vi.fn()} />);
        expect(trigger().textContent).toContain('Abyssal Fenri Khaliriz — Lv 33');
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

    it('selecting Eelun loads her anchored at T1 with Sitri, Beleth and Corson', () => {
        const onChange = vi.fn();
        render(<BossEncounterPicker board={{}} onChange={onChange} />);
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: 'Eelun Naphula — Lv 32' }));
        const board = onChange.mock.calls[0][0] as BoardState;
        expect(Object.keys(board).sort()).toEqual(['B3', 'M3', 'M4', 'T1', 'T3']);
        expect(board.T1?.ship.id).toBe('boss:eelun:32');
        expect(board.T3?.ship.id).toBe('npc:sitri:124');
        expect(board.B3?.ship.id).toBe('npc:sitri:124');
        expect(board.M3?.ship.id).toBe('npc:beleth:124');
        expect(board.M4?.ship.id).toBe('npc:corson:124');
    });

    it('lists Abyssal Fenri by its own name and loads him with two torpedoes', () => {
        const onChange = vi.fn();
        render(<BossEncounterPicker board={{}} onChange={onChange} />);
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('option', { name: 'Abyssal Fenri Khaliriz — Lv 33' }));
        const board = onChange.mock.calls[0][0] as BoardState;
        expect(Object.keys(board).sort()).toEqual(['M1', 'T2', 'T4']);
        expect(board.M1?.ship.id).toBe('boss:fenri:33');
        expect(board.M2).toBeUndefined();
        expect(board.T2?.ship.id).toBe('npc:torpedo:135');
        expect(board.T4?.ship.id).toBe('npc:torpedo:135');
    });
});
