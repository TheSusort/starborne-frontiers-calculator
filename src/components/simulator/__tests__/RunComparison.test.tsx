import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RunComparison from '../RunComparison';
import type { SeedSetAggregate } from '../../../utils/simulator/seededRuns';

const roster = [
    { actorId: 'focus', side: 'player' as const, name: 'Xcellence', position: 'T1' as const },
];

const aggregate = (
    wins: SeedSetAggregate['wins'],
    meanRounds: number,
    dealt: number,
    baseSeed = 500,
    count = 20
): SeedSetAggregate => ({
    baseSeed,
    count,
    roster,
    runs: [],
    wins,
    meanRounds,
    medianRounds: Math.round(meanRounds),
    perActorMean: { focus: { damageDealt: dealt, damageTaken: 0, healingDone: 0 } },
});

const baseline = {
    aggregate: aggregate({ player: 8, enemy: 12, draw: 0 }, 6, 1000),
    overrides: {},
};
const current = aggregate({ player: 13, enemy: 7, draw: 0 }, 5, 1400);
const currentOverrides = { 'player:T1': { attack: 12650 } };

describe('RunComparison', () => {
    it('shows both win counts with a signed delta', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
                roster={roster}
            />
        );
        expect(screen.getByText('8')).toBeInTheDocument();
        expect(screen.getByText('13')).toBeInTheDocument();
        expect(screen.getByText('+5')).toBeInTheDocument();
    });

    it('shows the mean-rounds delta signed', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
                roster={roster}
            />
        );
        expect(screen.getByText('-1.0')).toBeInTheDocument();
    });

    it('shows per-actor mean damage for both configurations with a delta', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
                roster={roster}
            />
        );
        expect(screen.getByText('Xcellence')).toBeInTheDocument();
        expect(screen.getByText('1000')).toBeInTheDocument();
        expect(screen.getByText('1400')).toBeInTheDocument();
        expect(screen.getByText('+400')).toBeInTheDocument();
    });

    it('lists one override-diff row per changed stat, naming side, position and stat', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
                roster={roster}
            />
        );
        const row = screen.getByText(/player:T1/).closest('tr') ?? screen.getByText(/player:T1/);
        expect(row).toHaveTextContent(/attack/i);
        expect(row).toHaveTextContent('12650');
    });

    it("shows the baseline's own seed and run count, not the current aggregate's", () => {
        const divergentBaseline = {
            aggregate: aggregate({ player: 8, enemy: 12, draw: 0 }, 6, 1000, 777, 30),
            overrides: {},
        };
        render(
            <RunComparison
                baseline={divergentBaseline}
                current={current}
                currentOverrides={currentOverrides}
                roster={roster}
            />
        );
        expect(screen.getByText(/Base seed 777/)).toBeInTheDocument();
        expect(screen.getByText(/over 30 runs/)).toBeInTheDocument();
    });
});
