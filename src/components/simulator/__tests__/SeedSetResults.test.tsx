import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeedSetResults from '../SeedSetResults';
import type { SeedSetAggregate } from '../../../utils/simulator/seededRuns';

const roster = [
    { actorId: 'focus', side: 'player' as const, name: 'Xcellence', position: 'T1' as const },
];

const aggregate: SeedSetAggregate = {
    baseSeed: 500,
    count: 2,
    roster,
    runs: [
        {
            seed: 500,
            winner: 'player',
            lastRound: 4,
            perActor: { focus: { damageDealt: 1000, damageTaken: 200, healingDone: 0 } },
        },
        {
            seed: 501,
            winner: 'enemy',
            lastRound: 6,
            perActor: { focus: { damageDealt: 600, damageTaken: 900, healingDone: 0 } },
        },
    ],
    wins: { player: 1, enemy: 1, draw: 0 },
    meanRounds: 5,
    medianRounds: 6,
    perActorMean: { focus: { damageDealt: 800, damageTaken: 550, healingDone: 0 } },
};

describe('SeedSetResults', () => {
    it('shows the win split and the round averages', () => {
        render(<SeedSetResults aggregate={aggregate} roster={roster} onOpenSeed={() => {}} />);
        expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
        expect(screen.getByText('5.0')).toBeInTheDocument();
    });

    it('names each actor from the roster rather than showing a raw actorId', () => {
        render(<SeedSetResults aggregate={aggregate} roster={roster} onOpenSeed={() => {}} />);
        expect(screen.getByText('Xcellence')).toBeInTheDocument();
        expect(screen.queryByText('focus')).not.toBeInTheDocument();
    });

    it('asks to open a single seed when its row is clicked', async () => {
        const onOpenSeed = vi.fn();
        render(<SeedSetResults aggregate={aggregate} roster={roster} onOpenSeed={onOpenSeed} />);
        await userEvent.click(screen.getByRole('button', { name: /seed 501/i }));
        expect(onOpenSeed).toHaveBeenCalledWith(501);
    });
});
