import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TargetingBoard, { DEMO_ENEMIES, DEMO_CASTER } from '../TargetingBoard';
import { DEMO_PATTERNS } from '../targetingBoardDemo';
import { resolveCells } from '../../../utils/targeting/resolvePattern';
import type { ParsedPattern } from '../../../utils/targetingParser';

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

/** Enemy positions covered by the pattern with no ship there. */
const coveredEmpty = (): string[] =>
    screen
        .getAllByTestId(/^enemy-cell-/)
        .filter((el) => el.getAttribute('data-hit') === 'coveredEmpty')
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

    it('a Circle anchored on T4 splashes the same occupied cells as Cone', async () => {
        render(<TargetingBoard />);
        await userEvent.click(screen.getByRole('button', { name: 'Circle' }));
        expect(primaries()).toEqual(['T4']);
        // circle|1| covers 6 neighbor cells from its anchor; from a corner anchor like T4, four
        // of them fall off the board and are never rendered. The two that remain, T3 and M4, are
        // the same cells cone|1| covers from T4 — kept as a separate button anyway (product
        // decision), even though this particular anchor makes the two look identical.
        expect(splash()).toEqual(['M4', 'T3']);
        expect(coveredEmpty()).toEqual([]);
    });

    it('a Range 3 anchored on T4 splashes occupied cells and marks the empty one covered', async () => {
        render(<TargetingBoard />);
        await userEvent.click(screen.getByRole('button', { name: 'Range' }));
        expect(primaries()).toEqual(['T4']);
        // range|3| covers T3, T2, T1 from a T4 anchor. T1 and T3 are occupied (splash); T2 is
        // empty in DEMO_ENEMIES, so it must show as the distinct "covered but empty" state
        // rather than being dropped from the board entirely.
        expect(splash()).toEqual(['T1', 'T3']);
        expect(coveredEmpty()).toEqual(['T2']);
    });

    it('every DEMO_PATTERNS entry resolves anchored on T4 without throwing', () => {
        // Guards the assumption DEMO_PATTERNS relies on instead of a runtime try/catch:
        // every demo signature must exist in OFFSET_TABLES, or resolveCells throws.
        for (const { shape, range } of DEMO_PATTERNS) {
            const pattern: ParsedPattern = {
                raw: `demo-${shape}-${range}`,
                shape,
                range,
                modifiers: {},
            };
            expect(() => resolveCells(pattern, 'T4')).not.toThrow();
        }
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

    it('tells the reader a pattern is clipped at the edge of the board', () => {
        // Circle and Cone render an identical footprint from the T4 anchor (the two tests
        // above pin that). Without this note it reads as a bug rather than the mechanic.
        render(<TargetingBoard />);
        expect(
            screen.getByText('Patterns are clipped at the edge of the board')
        ).toBeInTheDocument();
    });
});
