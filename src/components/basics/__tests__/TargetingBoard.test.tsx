import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TargetingBoard, { DEMO_ENEMIES, DEMO_CASTER } from '../TargetingBoard';

/** Enemy positions currently marked as the main target. */
const primaries = (): string[] =>
    screen
        .getAllByTestId(/^enemy-cell-/)
        .filter((el) => el.getAttribute('data-hit') === 'primary')
        .map((el) => el.getAttribute('data-position')!);

/** Enemy positions currently marked as splash. */
const splash = (): string[] =>
    screen
        .getAllByTestId(/^enemy-cell-/)
        .filter((el) => el.getAttribute('data-hit') === 'splash')
        .map((el) => el.getAttribute('data-position')!)
        .sort();

describe('TargetingBoard', () => {
    it('uses a demo setup where Front, Skip and Back all resolve to DIFFERENT ships', () => {
        // Fixture guards. Without three ships in the hit row, Back and Skip resolve to the same
        // cell, the reader sees nothing change when clicking between them, and the two
        // assertions below stop being able to catch a swapped implementation.
        expect(DEMO_CASTER).toBe('B2');
        expect(DEMO_ENEMIES).toEqual(['T1', 'T3', 'T4', 'M2', 'M4']);
        // Caster is bottom row; the enemy bottom row must stay EMPTY or the wrap is never exercised.
        expect(DEMO_ENEMIES.some((p) => p.startsWith('B'))).toBe(false);
    });

    it('renders both fleets — 12 cells each', () => {
        render(<TargetingBoard />);
        expect(screen.getAllByTestId(/^player-cell-/)).toHaveLength(12);
        expect(screen.getAllByTestId(/^enemy-cell-/)).toHaveLength(12);
    });

    it('marks the caster on the player board and nowhere else', () => {
        render(<TargetingBoard />);
        const casters = screen
            .getAllByTestId(/^player-cell-/)
            .filter((el) => el.getAttribute('data-caster') === 'true')
            .map((el) => el.getAttribute('data-position'));
        expect(casters).toEqual([DEMO_CASTER]);
    });

    it('defaults to Front and hits the front-most enemy in the TOP row', () => {
        render(<TargetingBoard />);
        // Caster is bottom row; the enemy bottom row is empty, so the scan wraps bottom -> top.
        // Within the top row, position 4 is the front.
        expect(primaries()).toEqual(['T4']);
    });

    it('Back hits the rear-most enemy in that same row', async () => {
        render(<TargetingBoard />);
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(primaries()).toEqual(['T1']);
    });

    it('Skip jumps the front-most and hits the one behind it', async () => {
        render(<TargetingBoard />);
        await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
        // Occupied top row front-to-back is T4, T3, T1 — skipping T4 anchors on T3, not T1.
        expect(primaries()).toEqual(['T3']);
    });

    it('All hits every living enemy', async () => {
        render(<TargetingBoard />);
        await userEvent.click(screen.getByRole('button', { name: 'All' }));
        expect(primaries().sort()).toEqual([...DEMO_ENEMIES].sort());
    });

    it('Single Target is the default pattern and adds no splash', () => {
        render(<TargetingBoard />);
        expect(splash()).toEqual([]);
    });

    it('a Cone anchored on T4 splashes exactly the occupied cells it covers', async () => {
        render(<TargetingBoard />);
        await userEvent.click(screen.getByRole('button', { name: 'Cone' }));
        expect(primaries()).toEqual(['T4']);
        // cone|1| covers T3 and M4 from a T4 anchor. Its third covered cell is off-board.
        expect(splash()).toEqual(['M4', 'T3']);
    });

    it('a Line anchored on T4 splashes only the cell directly behind it', async () => {
        render(<TargetingBoard />);
        await userEvent.click(screen.getByRole('button', { name: 'Line' }));
        expect(splash()).toEqual(['T3']);
    });

    it('shows the rule description from TARGETING_RULES, not hardcoded copy', async () => {
        const { TARGETING_RULES } = await import('../../../constants/targetingRules');
        render(<TargetingBoard />);
        expect(screen.getByText(TARGETING_RULES.front.description)).toBeInTheDocument();
    });

    it('offers the four enemy-side rules and no ally-side ones', () => {
        render(<TargetingBoard />);
        for (const label of ['Front', 'Back', 'Skip', 'All']) {
            expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
        }
        expect(screen.queryByRole('button', { name: 'Self' })).not.toBeInTheDocument();
    });
});
