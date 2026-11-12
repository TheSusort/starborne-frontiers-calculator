// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeedStrip from '../SeedStrip';
import type { SeedRunSummary } from '../../../utils/simulator/seededRuns';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const runs: SeedRunSummary[] = [
    { seed: 500, winner: 'player', lastRound: 4, perActor: {} },
    { seed: 501, winner: 'enemy', lastRound: 6, perActor: {} },
    { seed: 502, winner: 'player', lastRound: 5, perActor: {} },
];

const manyRuns = (count: number, baseSeed = 1000): SeedRunSummary[] =>
    Array.from({ length: count }, (_, i) => ({
        seed: baseSeed + i,
        winner: 'player',
        lastRound: 1,
        perActor: {},
    }));

describe('SeedStrip', () => {
    it('renders one labelled square per seed', () => {
        render(<SeedStrip runs={runs} openedSeed={null} onOpenSeed={() => {}} />);
        expect(screen.getByRole('button', { name: 'Seed 500: Your team wins in round 4' })).toBe(
            screen.getByTitle('Seed 500: Your team wins in round 4')
        );
        expect(
            screen.getByRole('button', { name: 'Seed 501: Enemy wins in round 6' })
        ).toBeInTheDocument();
    });

    it('marks the opened seed pressed and no other', () => {
        render(<SeedStrip runs={runs} openedSeed={501} onOpenSeed={() => {}} />);
        expect(screen.getByRole('button', { name: /seed 501/i })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        expect(screen.getByRole('button', { name: /seed 500/i })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });

    it('says which seed is shown and its place in the run', () => {
        render(<SeedStrip runs={runs} openedSeed={501} onOpenSeed={() => {}} />);
        expect(screen.getByText('Seed 501 · 2 of 3')).toBeInTheDocument();
    });

    it('asks to open a seed when its square is clicked', async () => {
        const onOpenSeed = vi.fn();
        render(<SeedStrip runs={runs} openedSeed={500} onOpenSeed={onOpenSeed} />);
        await userEvent.click(screen.getByRole('button', { name: /seed 502/i }));
        expect(onOpenSeed).toHaveBeenCalledWith(502);
    });

    it('shows only the first 200 seeds and pages to the rest', async () => {
        render(<SeedStrip runs={manyRuns(250)} openedSeed={null} onOpenSeed={() => {}} />);
        expect(screen.getByRole('button', { name: /seed 1199:/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /seed 1200:/i })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: '2' }));
        expect(screen.getByRole('button', { name: /seed 1249:/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /seed 1000:/i })).not.toBeInTheDocument();
    });

    it('resets to page 1 when a shorter run replaces a longer one', async () => {
        const { rerender } = render(
            <SeedStrip runs={manyRuns(250)} openedSeed={null} onOpenSeed={() => {}} />
        );
        await userEvent.click(screen.getByRole('button', { name: '2' }));
        rerender(<SeedStrip runs={runs} openedSeed={null} onOpenSeed={() => {}} />);
        expect(screen.getByRole('button', { name: /seed 500:/i })).toBeInTheDocument();
        expect(screen.queryByLabelText(/next page/i)).not.toBeInTheDocument();
    });

    it('shows a key naming what each colour means', () => {
        render(<SeedStrip runs={runs} openedSeed={null} onOpenSeed={() => {}} />);
        expect(screen.getByText('Your team wins')).toBeInTheDocument();
        expect(screen.getByText('Enemy wins')).toBeInTheDocument();
    });

    it('marks enemy wins with more than colour', () => {
        render(<SeedStrip runs={runs} openedSeed={null} onOpenSeed={() => {}} />);
        const enemy = screen.getByRole('button', { name: /seed 501/i });
        const player = screen.getByRole('button', { name: /seed 500/i });
        expect(enemy.className).toMatch(/repeating-linear-gradient/);
        expect(player.className).not.toMatch(/repeating-linear-gradient/);
    });

    it('makes the squares larger on phones', () => {
        render(<SeedStrip runs={runs} openedSeed={null} onOpenSeed={() => {}} />);
        expect(screen.getByRole('button', { name: /seed 500/i }).className).toMatch(
            /\bh-6\b.*\bsm:h-4\b/
        );
    });

    it('puts the page controls before the squares in tab order', () => {
        render(<SeedStrip runs={manyRuns(250)} openedSeed={null} onOpenSeed={() => {}} />);
        const next = screen.getByLabelText(/next page/i);
        const firstSeed = screen.getByRole('button', { name: /seed 1000:/i });
        expect(next.compareDocumentPosition(firstSeed) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
        );
    });
});
