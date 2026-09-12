import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import FormationGrid from '../FormationGrid';

// FormationGrid resolves ships via these contexts; an empty fleet keeps every cell empty so
// each renders its position label (e.g. "T1"), which we use to assert column render order.
vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));
vi.mock('../../../hooks/useShipsData', () => ({ useShipsData: () => ({ ships: [] }) }));

/** Read the position labels of the FIRST row (top row) in DOM order. */
const firstRowLabels = (): string[] => {
    const grid = screen.getByRole('grid');
    // The top row is the first row container holding the T-cells.
    const topRow = within(grid)
        .getAllByText(/^[TMB][1-4]$/)
        .filter((el) => /^T[1-4]$/.test(el.textContent ?? ''))
        .map((el) => el.textContent);
    return topRow;
};

describe('FormationGrid mirrored', () => {
    it('renders columns in natural order by default (T1..T4 left-to-right)', () => {
        render(<FormationGrid formation={[]} />);
        expect(firstRowLabels()).toEqual(['T1', 'T2', 'T3', 'T4']);
    });

    it('reverses column order within each row when mirrored (T4..T1, col4=front leftmost)', () => {
        render(<FormationGrid formation={[]} mirrored />);
        expect(firstRowLabels()).toEqual(['T4', 'T3', 'T2', 'T1']);
    });

    it('shows a front facing cue only when showFacingCue is set', () => {
        const { rerender } = render(<FormationGrid formation={[]} />);
        expect(screen.queryByText('front')).not.toBeInTheDocument();

        rerender(<FormationGrid formation={[]} showFacingCue />);
        expect(screen.getByText('front')).toBeInTheDocument();
    });

    it('Shift+Clicking an empty cell selects the position instead of editing stats', () => {
        const onPositionSelect = vi.fn();
        const onEditStats = vi.fn();
        render(
            <FormationGrid
                formation={[]}
                onPositionSelect={onPositionSelect}
                onEditStats={onEditStats}
            />
        );

        fireEvent.click(screen.getByText('T1').closest('button')!, { shiftKey: true });

        expect(onPositionSelect).toHaveBeenCalledWith('T1');
        expect(onEditStats).not.toHaveBeenCalled();
    });
});

describe('FormationGrid on-cell edit control', () => {
    // A SharedShipPosition entry resolves to a ship via its own shipName, independent of the
    // useShips mock (which returns no ships) — the simplest way to occupy a cell here.
    const occupiedFormation = [{ shipId: 's1', shipName: 'Nova', position: 'T1' as const }];

    it('renders an Edit button on an occupied cell when onEditStats is supplied', () => {
        render(<FormationGrid formation={occupiedFormation} onEditStats={() => {}} />);
        expect(screen.getByRole('button', { name: /edit nova's stats/i })).toBeInTheDocument();
    });

    it('renders no Edit button when onEditStats is not supplied (Encounters usage)', () => {
        render(<FormationGrid formation={occupiedFormation} />);
        expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    });

    it('renders no Edit button on an empty cell even when onEditStats is supplied', () => {
        render(<FormationGrid formation={[]} onEditStats={() => {}} />);
        expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    });

    it('clicking the Edit button opens the stat editor and does not select/replace the ship', () => {
        const onEditStats = vi.fn();
        const onPositionSelect = vi.fn();
        render(
            <FormationGrid
                formation={occupiedFormation}
                onEditStats={onEditStats}
                onPositionSelect={onPositionSelect}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /edit nova's stats/i }));

        expect(onEditStats).toHaveBeenCalledWith('T1');
        expect(onPositionSelect).not.toHaveBeenCalled();
    });

    it('works on the mirrored enemy board too', () => {
        const onEditStats = vi.fn();
        render(<FormationGrid formation={occupiedFormation} onEditStats={onEditStats} mirrored />);

        fireEvent.click(screen.getByRole('button', { name: /edit nova's stats/i }));

        expect(onEditStats).toHaveBeenCalledWith('T1');
    });

    // Nested interactive elements (a <button> inside another <button>) have undefined
    // accessibility semantics — undefined focus order and ambiguous screen-reader
    // announcement. The Edit control must render outside the cell's own button.
    it('is not nested inside another button', () => {
        render(<FormationGrid formation={occupiedFormation} onEditStats={() => {}} />);

        const editButton = screen.getByRole('button', { name: /edit nova's stats/i });

        expect(editButton.closest('button')).toBe(editButton);
    });
});
