import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
        .map((el) => el.textContent as string);
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
});
