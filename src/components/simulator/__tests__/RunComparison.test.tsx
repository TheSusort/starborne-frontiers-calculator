import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import RunComparison from '../RunComparison';
import type { SeedRunSummary, SeedSetAggregate } from '../../../utils/simulator/seededRuns';
import type { BattleSimulationInput } from '../../../utils/calculators/battleSimulator';
import type { PinnedBaseline } from '../../../utils/simulator/compareRuns';

const emptyInput: BattleSimulationInput = { playerTeam: [], enemyTeam: [] };

/** Wraps an aggregate as a pinned baseline. The input is inert here — `RunComparison` never reads
 *  `baseline.input`. */
const pinned = (aggregate: SeedSetAggregate): PinnedBaseline => ({
    aggregate,
    overrides: {},
    input: emptyInput,
});

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
const baseline = pinned(aggregate(4, 6, 1000, 1));
const current = aggregate(19, 5, 1400, 1);

/** A change that is not: 10/20 becomes 12/20 with everything else barely moving. */
const noiseBaseline = pinned(aggregate(10, 6, 1000, 2));
const noiseCurrent = aggregate(12, 6, 1020, 2);

const currentOverrides = { 'player:T1': { attack: 12650 } };

describe('RunComparison', () => {
    it('shows both win counts with a signed delta', () => {
        render(
            <RunComparison
                baseline={baseline}
                current={current}
                currentOverrides={currentOverrides}
                onOpenDivergence={() => {}}
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
                onOpenDivergence={() => {}}
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
                onOpenDivergence={() => {}}
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
                onOpenDivergence={() => {}}
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
        const divergentBaseline = pinned(divergentSeedSet(8, 6, 1000));
        const divergentCurrent = { ...divergentSeedSet(13, 5, 1400), baseSeed: 500, count: 20 };
        render(
            <RunComparison
                baseline={divergentBaseline}
                current={divergentCurrent}
                currentOverrides={currentOverrides}
                onOpenDivergence={() => {}}
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
                onOpenDivergence={() => {}}
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
                onOpenDivergence={() => {}}
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
                onOpenDivergence={() => {}}
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
                onOpenDivergence={() => {}}
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

    it('calls a five-of-twenty same-direction win-count flip not distinguishable, the case the t rule alone gets wrong', () => {
        // Same shape as the low-level sign-test fixture (deltaStats.test.ts): 5 flips out of 20,
        // all one direction. The t rule alone reads t ≈ 2.52 (over the threshold, a false
        // result); the exact sign test the win rows actually run reads p = 2 * 0.5^5 = 0.0625
        // (under the cutoff) — not distinguishable. Pins that win rows take the sign test rather
        // than the t rule.
        const flipBaseline = pinned(aggregate(10, 6, 1000, 0));
        const flipCurrent = aggregate(15, 6, 1000, 0);
        render(
            <RunComparison
                baseline={flipBaseline}
                current={flipCurrent}
                currentOverrides={currentOverrides}
                onOpenDivergence={() => {}}
            />
        );
        const row = screen.getByText('Player wins').closest('tr')!;
        expect(row).toHaveTextContent(/not distinguishable/i);
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
                onOpenDivergence={() => {}}
            />
        );
        const row = screen.getByText('Draws').closest('tr')!;
        expect(row).toHaveTextContent('0.0');
        expect(row).not.toHaveTextContent(/not distinguishable/);
        const zero = within(row).getByText('0.0');
        expect(zero).toHaveClass('text-theme-text-secondary');
    });

    /** Builds a same-roster aggregate from explicit per-seed `lastRound` values, with `meanRounds`
     *  and `medianRounds` derived from those runs the way real aggregation does (never hand-set),
     *  so the fixture cannot land in a state the app itself could not produce. */
    const roundsAggregate = (lastRounds: number[]): SeedSetAggregate => {
        const runs: SeedRunSummary[] = lastRounds.map((lastRound, i) => ({
            seed: BASE_SEED + i,
            winner: 'draw',
            lastRound,
            perActor: { focus: { damageDealt: 0, damageTaken: 0, healingDone: 0 } },
        }));
        const sorted = [...lastRounds].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        return {
            baseSeed: BASE_SEED,
            count: lastRounds.length,
            roster,
            runs,
            wins: { player: 0, enemy: 0, draw: lastRounds.length },
            meanRounds: lastRounds.reduce((a, b) => a + b, 0) / lastRounds.length,
            medianRounds: median,
            perActorMean: { focus: { damageDealt: 0, damageTaken: 0, healingDone: 0 } },
        };
    };

    it('notes a skewed round-count distribution when the mean and median disagree and the mean move is distinguishable', () => {
        // Baseline: 20 seeds all at 6 rounds. Current: 13 seeds drop to 5, 7 seeds run long at
        // 101 — current mean 38.6 (delta +32.6, t ≈ 3.10 against df=19's 2.093 critical value,
        // comfortably distinguishable) against current median 5 (delta -1). Mean and median
        // disagree in sign, and the mean move is real, not noise.
        const skewedBaseline = pinned(roundsAggregate(new Array<number>(20).fill(6)));
        const skewedCurrent = roundsAggregate([
            ...new Array<number>(13).fill(5),
            ...new Array<number>(7).fill(101),
        ]);
        render(
            <RunComparison
                baseline={skewedBaseline}
                current={skewedCurrent}
                currentOverrides={{}}
                onOpenDivergence={() => {}}
            />
        );
        expect(screen.getByText(/skewed/i)).toBeInTheDocument();
    });

    it('says nothing about skew when the mean/median disagreement is not distinguishable from noise', () => {
        // Reachable case: 19 seeds each shorten by one round (6 -> 5, which drags the median down
        // to 5) and one seed runs long at 46 (which pulls the mean up to 7.05) — but a single
        // outlier among 19 concordant seeds can never clear the t threshold (t ≈ 0.51 here), so
        // the Mean rounds row itself reads "not distinguishable" and the banner must agree.
        const noisyBaseline = pinned(roundsAggregate(new Array<number>(20).fill(6)));
        const noisyCurrent = roundsAggregate([...new Array<number>(19).fill(5), 46]);
        render(
            <RunComparison
                baseline={noisyBaseline}
                current={noisyCurrent}
                currentOverrides={{}}
                onOpenDivergence={() => {}}
            />
        );
        expect(screen.queryByText(/skewed/i)).not.toBeInTheDocument();
        const row = screen.getByText('Mean rounds').closest('tr')!;
        expect(row).toHaveTextContent(/not distinguishable/i);
    });
});

describe('diverging seeds', () => {
    /** Same seed set, same everything, except that seed 502 flips from an enemy win to a player
     *  win and takes three rounds longer. */
    const flipOneSeed = () => {
        const base = aggregate(10, 6, 1000, 0);
        const variant = aggregate(10, 6, 1000, 0);
        variant.runs[2] = { ...variant.runs[2], winner: 'player', lastRound: 9 };
        base.runs[2] = { ...base.runs[2], winner: 'enemy', lastRound: 6 };
        return { base, variant };
    };

    it('lists only the seeds whose winner changed', () => {
        const { base, variant } = flipOneSeed();
        render(
            <RunComparison
                baseline={pinned(base)}
                current={variant}
                currentOverrides={currentOverrides}
                onOpenDivergence={() => {}}
            />
        );
        expect(screen.getByText('502')).toBeInTheDocument();
        expect(screen.getByText('6 → 9')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /open/i })).toHaveLength(1);
    });

    it('hands the seed back when a row is opened', () => {
        const { base, variant } = flipOneSeed();
        const onOpenDivergence = vi.fn();
        render(
            <RunComparison
                baseline={pinned(base)}
                current={variant}
                currentOverrides={currentOverrides}
                onOpenDivergence={onOpenDivergence}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /open/i }));
        expect(onOpenDivergence).toHaveBeenCalledWith(502);
    });

    it('says the two configurations agreed rather than showing an empty table', () => {
        const same = aggregate(10, 6, 1000, 0);
        render(
            <RunComparison
                baseline={pinned(same)}
                current={aggregate(10, 6, 1400, 0)}
                currentOverrides={currentOverrides}
                onOpenDivergence={() => {}}
            />
        );
        expect(screen.getByText(/same winner on every seed/i)).toBeInTheDocument();
    });
});
