// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SeedSetResults from '../SeedSetResults';
import type { SeedSetAggregate } from '../../../utils/simulator/seededRuns';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const roster = [
    { actorId: 'focus', side: 'player' as const, name: 'Xcellence', position: 'T1' as const },
    { actorId: 'e0', side: 'enemy' as const, name: 'Hexa', position: 'T4' as const },
];

const aggregate: SeedSetAggregate = {
    baseSeed: 500,
    count: 2,
    roster,
    runs: [
        { seed: 500, winner: 'player', lastRound: 4, perActor: {} },
        { seed: 501, winner: 'enemy', lastRound: 6, perActor: {} },
    ],
    wins: { player: 1, enemy: 1 },
    meanRounds: 5,
    medianRounds: 6,
    perActorMean: {
        focus: { damageDealt: 1800, damageTaken: 550, healingDone: 0 },
        e0: { damageDealt: 400, damageTaken: 1800, healingDone: 0 },
    },
};

describe('SeedSetResults', () => {
    it('shows the verdict tiles for the run', () => {
        render(<SeedSetResults aggregate={aggregate} />);
        expect(screen.getByText('Your win rate').parentElement).toHaveTextContent('50%');
        expect(screen.getByText('Your win rate').parentElement).toHaveTextContent('1 of 2');
        expect(screen.getByText('Fight length').parentElement).toHaveTextContent('5.0');
    });

    it('lists each ship by roster name under its side, never a raw actorId', () => {
        render(<SeedSetResults aggregate={aggregate} />);
        const table = screen.getByRole('table');
        expect(within(table).getByText('Xcellence')).toBeInTheDocument();
        expect(within(table).getByText('Hexa')).toBeInTheDocument();
        expect(within(table).getByText('Your team')).toBeInTheDocument();
        expect(screen.queryByText('focus')).not.toBeInTheDocument();
    });

    it('formats the breakdown numbers with thousands separators', () => {
        render(<SeedSetResults aggregate={aggregate} />);
        expect(screen.getAllByText('1,800').length).toBeGreaterThan(0);
    });
});
