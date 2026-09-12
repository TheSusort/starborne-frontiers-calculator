import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import RunComparison from '../RunComparison';
import type { SeedRunSummary, SeedSetAggregate } from '../../../utils/simulator/seededRuns';

const roster = [
    { actorId: 'focus', side: 'player' as const, name: 'Xcellence', position: 'T1' as const },
];

const BASE_SEED = 500;
const COUNT = 20;

/** Per-seed runs whose winners, rounds and damage produce a given aggregate. `wins` player-wins
 *  come first; `rounds` and `dealt` are constant per seed unless `spread` is given, which
 *  alternates them by ±spread so a row has real variance to measure. */
const runsFor = (wins: number, rounds: number, dealt: number, spread = 0): SeedRunSummary[] =>
    Array.from({ length: COUNT }, (_, i) => {
        const swing = i % 2 === 0 ? spread : -spread;
        return {
            seed: BASE_SEED + i,
            winner: i < wins ? ('player' as const) : ('enemy' as const),
            lastRound: rounds + swing,
            perActor: {
                focus: { damageDealt: dealt + swing * 10, damageTaken: 0, healingDone: 0 },
            },
        };
    });

const aggregate = (wins: number, rounds: number, dealt: number, spread = 0): SeedSetAggregate => {
    const runs = runsFor(wins, rounds, dealt, spread);
    return {
        baseSeed: BASE_SEED,
        count: COUNT,
        roster,
        runs,
        wins: { player: wins, enemy: COUNT - wins, draw: 0 },
        meanRounds: runs.reduce((a, r) => a + r.lastRound, 0) / COUNT,
        medianRounds: rounds,
        perActorMean: {
            focus: {
                damageDealt: runs.reduce((a, r) => a + r.perActor.focus.damageDealt, 0) / COUNT,
                damageTaken: 0,
                healingDone: 0,
            },
        },
    };
};

/** A decisive change: 4/20 becomes 19/20. */
const baseline = { aggregate: aggregate(4, 6, 1000, 1), overrides: {} };
const current = aggregate(19, 5, 1400, 1);

/** A change that is not: 10/20 becomes 12/20 with everything else barely moving. */
const noiseBaseline = { aggregate: aggregate(10, 6, 1000, 2), overrides: {} };
const noiseCurrent = aggregate(12, 6, 1020, 2);

const currentOverrides = { 'player:T1': { attack: 12650 } };

describe('RunComparison', () => {
    it('shows both win counts with a signed delta', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
            />
        );
        expect(screen.getByText('4')).toBeInTheDocument();
        expect(screen.getByText('19')).toBeInTheDocument();
        expect(screen.getByText(/\+15\.0\s*±/)).toBeInTheDocument();
    });

    it('shows the mean-rounds delta signed', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
            />
        );
        expect(screen.getByText(/-1\.0\s*±/)).toBeInTheDocument();
    });

    it('shows per-actor mean damage for both configurations with a delta', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
            />
        );
        expect(screen.getByText('Xcellence')).toBeInTheDocument();
        expect(screen.getByText('1000')).toBeInTheDocument();
        expect(screen.getByText('1400')).toBeInTheDocument();
        expect(screen.getByText(/\+400\.0\s*±/)).toBeInTheDocument();
    });

    it('lists one override-diff row per changed stat, with side and position as separate columns and the stat label (not the raw key)', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
            />
        );
        const row = screen.getByText('player').closest('tr')!;
        expect(row).toHaveTextContent('T1');
        expect(row).toHaveTextContent('Attack');
        expect(row).toHaveTextContent('12650');
    });

    it("shows the baseline's own seed and run count, not the current aggregate's", () => {
        // pairedSeries pairs by `runs`, not by baseSeed/count, so the current aggregate below
        // carries the baseline's 30-seed run set but its own (different) baseSeed/count — the
        // fixture that actually discriminates "reads baseline.aggregate" from "reads current".
        const divergentSeedSet = (
            wins: number,
            rounds: number,
            dealt: number
        ): SeedSetAggregate => {
            const seedCount = 30;
            const seedBase = 777;
            const runs: SeedRunSummary[] = Array.from({ length: seedCount }, (_, i) => ({
                seed: seedBase + i,
                winner: i < wins ? 'player' : 'enemy',
                lastRound: rounds,
                perActor: { focus: { damageDealt: dealt, damageTaken: 0, healingDone: 0 } },
            }));
            return {
                baseSeed: seedBase,
                count: seedCount,
                roster,
                runs,
                wins: { player: wins, enemy: seedCount - wins, draw: 0 },
                meanRounds: rounds,
                medianRounds: rounds,
                perActorMean: { focus: { damageDealt: dealt, damageTaken: 0, healingDone: 0 } },
            };
        };
        const divergentBaseline = { aggregate: divergentSeedSet(8, 6, 1000), overrides: {} };
        const divergentCurrent = { ...divergentSeedSet(13, 5, 1400), baseSeed: 500, count: 20 };
        render(
            <RunComparison
                baseline={divergentBaseline}
                current={divergentCurrent}
                currentOverrides={currentOverrides}
            />
        );
        expect(screen.getByText(/Base seed 777/)).toBeInTheDocument();
        expect(screen.getByText(/over 30 runs/)).toBeInTheDocument();
    });

    it('shows no roster-mismatch warning when the baseline and current rosters match', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
            />
        );
        expect(screen.queryByText(/roster changed/i)).not.toBeInTheDocument();
    });

    it('warns when the current roster differs from the baseline (a board edit renumbered actors)', () => {
        const reshuffledCurrent: SeedSetAggregate = {
            ...current,
            roster: [
                { actorId: 'focus', side: 'player', name: 'A Different Ship', position: 'T2' },
            ],
        };
        render(
            <RunComparison
                baseline={baseline}
                current={reshuffledCurrent}
                currentOverrides={currentOverrides}
            />
        );
        expect(screen.getByText(/roster changed/i)).toBeInTheDocument();
    });
});

describe('RunComparison noise verdict', () => {
    it('renders a decisive win change as a signed delta with its spread, coloured for direction', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
            />
        );
        const deltaText = screen.getByText(/\+15\.0\s*±/);
        expect(deltaText).toBeInTheDocument();
        expect(deltaText).toHaveClass('text-green-400');
    });

    it('refuses to sign a win change that is indistinguishable from noise, with no direction colour', () => {
        render(
            <RunComparison
                baseline={noiseBaseline}
                current={noiseCurrent}
                currentOverrides={currentOverrides}
            />
        );
        // Scoped to the Player wins row specifically: a page-wide search for the noise wording
        // would also be satisfied by rows this fixture never touches (draws, mean rounds,
        // per-actor damage), so a partial revert of only this row would still pass.
        const row = screen.getByText('Player wins').closest('tr')!;
        expect(row).toHaveTextContent(/not distinguishable/);
        const refusal = within(row).getByText(/not distinguishable/i);
        expect(refusal).toHaveClass('text-theme-text-secondary');
        expect(refusal).not.toHaveClass('text-green-400');
        expect(refusal).not.toHaveClass('text-red-400');
        expect(screen.queryByText(/\+2\.0\s*±/)).not.toBeInTheDocument();
    });

    it('renders an unchanged row as a plain signed zero, not noise wording', () => {
        // Draws is 0 in both configurations for every fixture in this file (winner is always
        // 'player' or 'enemy'): baseline and current agree on every paired seed, so this is the
        // "nothing moved" case, not a difference too small to trust.
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
            />
        );
        const row = screen.getByText('Draws').closest('tr')!;
        expect(row).toHaveTextContent('0.0');
        expect(row).not.toHaveTextContent(/not distinguishable/);
        const zero = within(row).getByText('0.0');
        expect(zero).toHaveClass('text-theme-text-secondary');
    });

    it('notes a likely outlier when the mean and median round deltas disagree in sign', () => {
        // Mean rounds up, median rounds down: one fight dragged the mean the other way.
        const outlierBaseline = { aggregate: aggregate(10, 6, 1000, 0), overrides: {} };
        const outlierCurrent = { ...aggregate(10, 5, 1000, 0), meanRounds: 7, medianRounds: 5 };
        render(
            <RunComparison
                baseline={outlierBaseline}
                current={outlierCurrent}
                currentOverrides={{}}
            />
        );
        expect(screen.getByText(/outlier/i)).toBeInTheDocument();
    });
});
