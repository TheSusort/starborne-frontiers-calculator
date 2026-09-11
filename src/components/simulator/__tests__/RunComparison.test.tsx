import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RunComparison from '../RunComparison';
import type { SeedSetAggregate } from '../../../utils/simulator/seededRuns';

const roster = [
    { actorId: 'focus', side: 'player' as const, name: 'Xcellence', position: 'T1' as const },
];

const aggregate = (
    wins: SeedSetAggregate['wins'],
    meanRounds: number,
    dealt: number
): SeedSetAggregate => ({
    baseSeed: 500,
    count: 20,
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
                onUnpin={() => {}}
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
                onUnpin={() => {}}
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
                onUnpin={() => {}}
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
                onUnpin={() => {}}
            />
        );
        const row = screen.getByText(/player:T1/).closest('tr') ?? screen.getByText(/player:T1/);
        expect(row).toHaveTextContent(/attack/i);
        expect(row).toHaveTextContent('12650');
    });

    it('unpins on request', async () => {
        const onUnpin = vi.fn();
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
                roster={roster}
                onUnpin={onUnpin}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /unpin/i }));
        expect(onUnpin).toHaveBeenCalled();
    });
});
