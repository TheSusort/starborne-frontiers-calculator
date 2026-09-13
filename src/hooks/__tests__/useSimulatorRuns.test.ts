import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSimulatorRuns } from '../useSimulatorRuns';
import { snapshotOverrides } from '../../utils/simulator/compareRuns';
import type { BoardState } from '../../components/simulator/PlacementBoard';
import type { Position } from '../../types/encounters';
import type { Ship } from '../../types/ship';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import type { SeedSetAggregate } from '../../utils/simulator/seededRuns';

// buildTeam resolves each placement's full stat block through these — stub them so a bare fake
// Ship object is enough to build a BattlePlacement, matching SimulatorPage.playback.test.tsx.
vi.mock('../../utils/ship/combatStats', () => ({
    shipFinalStats: () => ({}),
    combatStatsFromShip: () => ({}),
}));

const fakeBattleResult: BattleResult = {
    rounds: [],
    outcome: { winner: 'draw', lastRound: 0 },
    roster: [],
    combatLog: [],
};

// Echoes back the seed/count it was called with, so a pin-then-inspect assertion can tell
// which call produced the aggregate it is holding.
const fakeAggregate = (baseSeed = 0, count = 0): SeedSetAggregate => ({
    baseSeed,
    count,
    roster: [],
    runs: [],
    wins: { player: 0, enemy: 0, draw: 0 },
    meanRounds: 0,
    medianRounds: 0,
    perActorMean: {},
});

const mockRunSeededBattle = vi.fn((..._args: unknown[]) => fakeBattleResult);

/** Parks the next async run until the returned `release` is called, so a test can observe the
 *  in-flight state. Without it a run resolves on the next microtask and `isRunning` is never
 *  observably true — a progress assertion made after the run lands passes even if the hook
 *  never sets progress at all. */
let pendingGate: Promise<void> | null = null;
function holdNextRun(): () => void {
    let release!: () => void;
    pendingGate = new Promise<void>((resolve) => {
        release = resolve;
    });
    return release;
}

const mockRunSeedSetAsync = vi.fn(async (...args: unknown[]) => {
    const baseSeed = args[1] as number;
    const count = args[2] as number;
    const options = args[3] as {
        signal?: AbortSignal;
        onProgress?: (completed: number, total: number) => void;
    };
    options.onProgress?.(1, count);
    if (pendingGate) {
        const gate = pendingGate;
        pendingGate = null;
        await gate;
    }
    // Honours the signal the way the real function does — a cancelled run resolves null, never
    // a partial aggregate — and otherwise echoes the seed/count exactly as `mockRunSeedSet`
    // does, which the file's existing pin-then-inspect assertions depend on.
    return options.signal?.aborted ? null : fakeAggregate(baseSeed, count);
});

// The hook only calls runSeededBattle and runSeedSetAsync — runSeedSet has no runtime consumer
// in this module graph (compareRuns/deltaStats import only its types), so it is not stubbed here.
vi.mock('../../utils/simulator/seededRuns', () => ({
    runSeededBattle: (...args: unknown[]) => mockRunSeededBattle(...args),
    runSeedSetAsync: (...args: unknown[]) => mockRunSeedSetAsync(...args),
}));

const ship = (id: string): Ship => ({ id, name: id }) as unknown as Ship;

const board = (position: Position, id: string, overrides?: Record<string, number>): BoardState => ({
    [position]: { ship: ship(id), overrides },
});

const statsDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

const baseArgs = (overrides: Partial<Parameters<typeof useSimulatorRuns>[0]> = {}) => ({
    playerBoard: board('T1', 'nova', { attack: 100 }),
    enemyBoard: board('T1', 'hexa'),
    statsDeps,
    playerSquadLeader: undefined,
    enemySquadLeader: undefined,
    getGearPiece: undefined,
    seed: 42,
    runCount: 5,
    ...overrides,
});

// Shared by every describe block below: each starts with an empty call history and no held
// gate. mockClear() does not drop a queued mockRejectedValueOnce/mockImplementationOnce, so any
// test that queues a one-shot mock value must consume it within that same test.
beforeEach(() => {
    mockRunSeededBattle.mockClear();
    mockRunSeedSetAsync.mockClear();
    pendingGate = null;
});

describe('useSimulatorRuns', () => {
    it('editing a board after a run does not change the recorded provenance, and a reopened seed replays the frozen input', async () => {
        const initialPlayerBoard = board('T1', 'nova', { attack: 100 });
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ playerBoard: initialPlayerBoard, runCount: 3 }) }
        );

        await act(async () => {
            result.current.handleRun();
        });

        const runInput = mockRunSeedSetAsync.mock.calls[0][0];
        const recordedOverrides = result.current.currentOverrides;
        expect(recordedOverrides).toEqual(
            snapshotOverrides(initialPlayerBoard, baseArgs().enemyBoard)
        );

        // Edit the board (a different override value) WITHOUT re-running.
        const editedPlayerBoard = board('T1', 'nova', { attack: 400 });
        rerender(baseArgs({ playerBoard: editedPlayerBoard, runCount: 3 }));

        // The provenance recorded at run time must not have moved.
        expect(result.current.currentOverrides).toEqual(recordedOverrides);
        expect(result.current.currentOverrides).not.toEqual(
            snapshotOverrides(editedPlayerBoard, baseArgs().enemyBoard)
        );

        // Reopening a seed row must replay the SAME input object that produced the aggregate,
        // not one rebuilt from the (now edited) live boards.
        act(() => result.current.handleOpenSeed(43));
        const replayedInput = mockRunSeededBattle.mock.calls[0][0];
        expect(replayedInput).toBe(runInput);
    });

    it('running again after a board edit refreshes the recorded provenance to the edited snapshot', async () => {
        const initialPlayerBoard = board('T1', 'nova', { attack: 100 });
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ playerBoard: initialPlayerBoard, runCount: 3 }) }
        );

        await act(async () => {
            result.current.handleRun();
        });
        const firstRunOverrides = result.current.currentOverrides;

        // Edit the board, then run again (as opposed to the frozen-provenance test above, which
        // never re-runs after the edit).
        const editedPlayerBoard = board('T1', 'nova', { attack: 400 });
        rerender(baseArgs({ playerBoard: editedPlayerBoard, runCount: 3 }));
        await act(async () => {
            result.current.handleRun();
        });

        expect(result.current.currentOverrides).toEqual(
            snapshotOverrides(editedPlayerBoard, baseArgs().enemyBoard)
        );
        expect(result.current.currentOverrides).not.toEqual(firstRunOverrides);
    });

    it('a run while a baseline is pinned uses the baseline seed and count, ignoring the caller-supplied seed/runCount', async () => {
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ seed: 42, runCount: 5 }) }
        );

        await act(async () => {
            result.current.handleRun();
        });
        act(() => result.current.handlePinBaseline());
        expect(result.current.baseline).not.toBeNull();

        // The page's own seed/runCount change (e.g. the user typed a new value into a now-locked
        // field) — the hook must still resolve to the baseline's seed set.
        rerender(baseArgs({ seed: 99, runCount: 10 }));
        expect(result.current.effectiveSeed).toBe(42);
        expect(result.current.effectiveRunCount).toBe(5);

        await act(async () => {
            result.current.handleRun();
        });
        const lastCall = mockRunSeedSetAsync.mock.calls[mockRunSeedSetAsync.mock.calls.length - 1];
        expect(lastCall[1]).toBe(42);
        expect(lastCall[2]).toBe(5);
    });

    it('pinning then re-running preserves the baseline (a new aggregate does not replace it)', async () => {
        const { result } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );

        await act(async () => {
            result.current.handleRun();
        });
        act(() => result.current.handlePinBaseline());
        const pinnedBaseline = result.current.baseline;
        expect(pinnedBaseline).not.toBeNull();

        await act(async () => {
            result.current.handleRun();
        });
        expect(result.current.baseline).toBe(pinnedBaseline);
        // The new run produced its own aggregate object, distinct from the pinned one.
        expect(result.current.aggregate).not.toBe(pinnedBaseline?.aggregate);
    });

    it('pins the input that RAN, not a fresh read of the boards at pin time', async () => {
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ playerBoard: board('T1', 'nova', { attack: 100 }) }) }
        );

        await act(async () => {
            result.current.handleRun();
        });
        // The exact object the run consumed. `handleRun` passes one `input` const to both
        // `runSeedSetAsync` and `setProvenance`, so identity against it is the check.
        const ranInput = mockRunSeedSetAsync.mock.calls[0][0];

        // The boards move on BEFORE the pin. A baseline is a snapshot of the run it names, so
        // pinning must reach for the recorded input rather than rebuilding from live state —
        // otherwise replaying the baseline later reproduces a fight that never happened.
        rerender(baseArgs({ playerBoard: board('T1', 'vanguard', { attack: 999 }) }));
        act(() => {
            result.current.handlePinBaseline();
        });

        expect(result.current.baseline?.input).toBe(ranInput);
    });

    it('handleOpenSeed reports an error instead of throwing when there is no run to replay', () => {
        const { result } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );

        act(() => result.current.handleOpenSeed(1));

        expect(result.current.runError).not.toBeNull();
        expect(mockRunSeededBattle).not.toHaveBeenCalled();
    });

    it('handlePinBaseline is a no-op before any run', () => {
        const { result } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );

        act(() => result.current.handlePinBaseline());

        expect(result.current.baseline).toBeNull();
    });

    it('keeps the same handleOpenSeed reference across a re-render that leaves provenance unchanged', async () => {
        // Pins referential stability across a re-render, not just across identical args.
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );

        await act(async () => {
            result.current.handleRun();
        });
        const firstHandleOpenSeed = result.current.handleOpenSeed;

        // New board object references, same underlying boards/getGearPiece/provenance.
        rerender(baseArgs());

        expect(result.current.handleOpenSeed).toBe(firstHandleOpenSeed);
    });
});

describe('useSimulatorRuns progress and cancellation', () => {
    it('exposes progress and a running flag while a multi-seed run is in flight', async () => {
        const release = holdNextRun();
        const { result } = renderHook(() => useSimulatorRuns(baseArgs({ runCount: 5 })));

        await act(async () => {
            result.current.handleRun();
        });

        // Parked inside runSeedSetAsync, after its first onProgress call. Asserting here rather
        // than after the run lands is the whole point: a progress value only checked at the end
        // is always null and proves nothing.
        expect(result.current.isRunning).toBe(true);
        expect(result.current.progress).toEqual({ completed: 1, total: 5 });

        await act(async () => {
            release();
        });

        expect(result.current.isRunning).toBe(false);
        expect(result.current.progress).toBeNull();
        expect(result.current.aggregate).not.toBeNull();
    });

    it('keeps a single run on the synchronous path', () => {
        const { result } = renderHook(() => useSimulatorRuns(baseArgs({ runCount: 1 })));
        act(() => {
            result.current.handleRun();
        });
        expect(mockRunSeedSetAsync).not.toHaveBeenCalled();
        expect(result.current.battleResult).not.toBeNull();
    });

    it('a synchronous single-seed run supersedes an in-flight multi-seed run', async () => {
        const release = holdNextRun();
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ runCount: 5 }) }
        );

        await act(async () => {
            result.current.handleRun();
        });
        expect(result.current.isRunning).toBe(true);

        // Contract: a synchronous run must supersede an in-flight async one regardless of what
        // the parked run does when it eventually lands, even though no user-reachable path
        // triggers this today — inputsDisabled locks Runs and swaps Run for Cancel for the whole
        // time a multi-seed run is in flight.
        rerender(baseArgs({ runCount: 1 }));
        act(() => {
            result.current.handleRun();
        });
        const singleRunResult = result.current.battleResult;
        expect(singleRunResult).not.toBeNull();

        await act(async () => {
            release();
        });

        expect(result.current.battleResult).toBe(singleRunResult);
        expect(result.current.aggregate).toBeNull();
        expect(result.current.isRunning).toBe(false);
        expect(result.current.progress).toBeNull();
    });

    it('leaves the previous aggregate and its provenance untouched when a run is cancelled', async () => {
        const { result } = renderHook(() => useSimulatorRuns(baseArgs({ runCount: 5 })));

        await act(async () => {
            result.current.handleRun();
        });
        const firstAggregate = result.current.aggregate;
        const firstOverrides = result.current.currentOverrides;
        expect(firstAggregate).not.toBeNull();

        const release = holdNextRun();
        await act(async () => {
            result.current.handleRun();
        });
        expect(result.current.isRunning).toBe(true);

        await act(async () => {
            result.current.handleCancel();
            release();
        });

        expect(result.current.aggregate).toBe(firstAggregate);
        expect(result.current.currentOverrides).toBe(firstOverrides);
        expect(result.current.runError).toBeNull();
        expect(result.current.progress).toBeNull();
        expect(result.current.isRunning).toBe(false);
    });

    it('passes an abort signal that handleCancel aborts', async () => {
        const release = holdNextRun();
        const { result } = renderHook(() => useSimulatorRuns(baseArgs({ runCount: 5 })));
        await act(async () => {
            result.current.handleRun();
        });
        await act(async () => {
            result.current.handleCancel();
            release();
        });
        const options = mockRunSeedSetAsync.mock.calls[0][3] as { signal: AbortSignal };
        expect(options.signal.aborted).toBe(true);
    });

    it('refuses to pin a baseline while a run is in flight', async () => {
        // A run in flight replaces the displayed aggregate when it lands. Pinning the old one
        // now would leave the baseline and the current run on DIFFERENT seed sets, which
        // RunComparison's paired statistics reject outright.
        const { result } = renderHook(() => useSimulatorRuns(baseArgs({ runCount: 5 })));
        await act(async () => {
            result.current.handleRun();
        });

        // Control: pinning between runs works, so the assertion below is about the in-flight
        // state and not about pinning being broken generally.
        act(() => {
            result.current.handlePinBaseline();
        });
        expect(result.current.baseline).not.toBeNull();
        act(() => {
            result.current.handleUnpinBaseline();
        });

        const release = holdNextRun();
        await act(async () => {
            result.current.handleRun();
        });
        act(() => {
            result.current.handlePinBaseline();
        });
        expect(result.current.baseline).toBeNull();

        await act(async () => {
            release();
        });
    });

    it('surfaces an async run failure as a run error and clears the displayed result', async () => {
        const { result } = renderHook(() => useSimulatorRuns(baseArgs({ runCount: 5 })));

        // Land a successful run first, so there is a non-null aggregate for the failing run
        // to clear — otherwise the null-aggregate assertion below would pass trivially.
        await act(async () => {
            result.current.handleRun();
        });
        expect(result.current.aggregate).not.toBeNull();

        mockRunSeedSetAsync.mockRejectedValueOnce(new Error('engine exploded'));
        await act(async () => {
            result.current.handleRun();
        });

        expect(result.current.runError).toBe('engine exploded');
        expect(result.current.aggregate).toBeNull();
        expect(result.current.isRunning).toBe(false);
    });
});

describe('divergence playback', () => {
    /** Runs, pins, then opens a divergence — the state every test in this block starts from. */
    const runPinAndOpen = async (seed = 507) => {
        const rendered = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );
        await act(async () => {
            rendered.result.current.handleRun();
        });
        act(() => {
            rendered.result.current.handlePinBaseline();
        });
        act(() => {
            rendered.result.current.handleOpenDivergence(seed);
        });
        return rendered;
    };

    it('replays both sides at the seed and hides the single-fight playback', async () => {
        const getGearPiece = () => undefined;
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            {
                initialProps: baseArgs({
                    playerBoard: board('T1', 'nova', { attack: 100 }),
                    getGearPiece,
                }),
            }
        );
        await act(async () => {
            result.current.handleRun();
        });
        act(() => {
            result.current.handlePinBaseline();
        });
        // The input the pin recorded. Captured now, before the board changes below, so it stays
        // a snapshot of the run that got pinned.
        const baselineInput = mockRunSeedSetAsync.mock.calls[0][0];

        // Re-run under a changed board so the CURRENT run's recorded input is a different object
        // from the pinned baseline's. Without this, `baseline.input` and `provenance.input` are
        // the same object (one run, then pinned) and no assertion on a replay call's input can
        // tell which one it actually used — asserting the wrong one would pass just as well.
        rerender(baseArgs({ playerBoard: board('T1', 'vanguard', { attack: 999 }), getGearPiece }));
        await act(async () => {
            result.current.handleRun();
        });
        const currentInput = mockRunSeedSetAsync.mock.calls[1][0];
        expect(currentInput).not.toBe(baselineInput);

        // Open a single playback first so `battleResult` starts non-null — otherwise the
        // "hides the single-fight playback" assertion below would pass even if
        // handleOpenDivergence never cleared it.
        act(() => {
            result.current.handleOpenSeed(509);
        });
        expect(result.current.battleResult).toBe(fakeBattleResult);

        act(() => {
            result.current.handleOpenDivergence(507);
        });

        expect(result.current.divergence?.seed).toBe(507);
        expect(result.current.divergence?.baseline).toBe(fakeBattleResult);
        expect(result.current.divergence?.current).toBe(fakeBattleResult);
        // A divergence pair and a single playback are alternatives, never both on the page.
        expect(result.current.battleResult).toBeNull();

        // The full call list (not just its tail) is asserted so this discriminates "exactly two
        // replays ran at 507" from "three or more, the last two of which happened to match" —
        // the earlier 509 call is the `handleOpenSeed` replay made above. Each replay's input
        // (call[0]) and getGearPiece (call[2]) are asserted, not just its seed (call[1]): the
        // first replay must use the pinned BASELINE's input, the second the CURRENT run's own
        // recorded input, and both must carry the same getGearPiece.
        const replayCalls = mockRunSeededBattle.mock.calls;
        expect(replayCalls).toHaveLength(3);
        expect(replayCalls[0][1]).toBe(509);
        expect(replayCalls[1][0]).toBe(baselineInput);
        expect(replayCalls[1][1]).toBe(507);
        expect(replayCalls[1][2]).toBe(getGearPiece);
        expect(replayCalls[2][0]).toBe(currentInput);
        expect(replayCalls[2][1]).toBe(507);
        expect(replayCalls[2][2]).toBe(getGearPiece);
    });

    it('does nothing without a pinned baseline', async () => {
        const { result } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );
        await act(async () => {
            result.current.handleRun();
        });
        act(() => {
            result.current.handleOpenDivergence(507);
        });
        expect(result.current.divergence).toBeNull();
        expect(result.current.runError).toMatch(/baseline/i);
    });

    it('clears the pair when a new run lands', async () => {
        const { result } = await runPinAndOpen();
        await act(async () => {
            result.current.handleRun();
        });
        expect(result.current.divergence).toBeNull();
    });

    it('keeps the pair when a run is cancelled, because a cancelled run writes nothing', async () => {
        const { result } = await runPinAndOpen();
        const release = holdNextRun();
        act(() => {
            result.current.handleRun();
        });
        act(() => {
            result.current.handleCancel();
        });
        await act(async () => {
            release();
        });
        expect(result.current.divergence?.seed).toBe(507);
    });

    it('clears the pair when the baseline is unpinned', async () => {
        const { result } = await runPinAndOpen();
        act(() => {
            result.current.handleUnpinBaseline();
        });
        expect(result.current.divergence).toBeNull();
    });

    it('clears the pair when a single seed is opened from the results list', async () => {
        const { result } = await runPinAndOpen();
        act(() => {
            result.current.handleOpenSeed(509);
        });
        expect(result.current.divergence).toBeNull();
        expect(result.current.battleResult).toBe(fakeBattleResult);
    });

    it('closes the pair without dropping the pinned baseline', async () => {
        const { result } = await runPinAndOpen();
        act(() => {
            result.current.handleCloseDivergence();
        });
        expect(result.current.divergence).toBeNull();
        // See handleCloseDivergence's doc: close is not unpin.
        expect(result.current.baseline).not.toBeNull();
    });

    it('reports a replay failure and shows no pair', async () => {
        // Start from a pair genuinely open at 507, so the null-divergence assertion below
        // discriminates "the failed replay cleared it" from "it was never opened."
        const { result } = await runPinAndOpen(507);
        expect(result.current.divergence?.seed).toBe(507);

        mockRunSeededBattle.mockImplementationOnce(() => {
            throw new Error('replay exploded');
        });
        act(() => {
            result.current.handleOpenDivergence(511);
        });
        expect(result.current.divergence).toBeNull();
        expect(result.current.runError).toBe('replay exploded');
    });

    it('a failed open clears the single fight that was on screen', async () => {
        const { result } = await runPinAndOpen(507);
        // Back to a single playback first: a pair and a single fight are mutually exclusive, so
        // this is the only state in which a failing open has a stale battleResult to leave behind.
        act(() => {
            result.current.handleOpenSeed(509);
        });
        expect(result.current.battleResult).not.toBeNull();

        mockRunSeededBattle.mockImplementationOnce(() => {
            throw new Error('replay exploded');
        });
        act(() => {
            result.current.handleOpenDivergence(511);
        });
        expect(result.current.battleResult).toBeNull();
        expect(result.current.runError).toBe('replay exploded');
    });

    it('a failed single-seed replay leaves no pair', async () => {
        const { result } = await runPinAndOpen();
        mockRunSeededBattle.mockImplementationOnce(() => {
            throw new Error('replay exploded');
        });
        act(() => {
            result.current.handleOpenSeed(509);
        });
        expect(result.current.divergence).toBeNull();
        expect(result.current.runError).toBe('replay exploded');
    });

    it('clears the pair when a multi-seed run rejects', async () => {
        const { result } = await runPinAndOpen();
        mockRunSeedSetAsync.mockRejectedValueOnce(new Error('engine exploded'));
        await act(async () => {
            result.current.handleRun();
        });
        expect(result.current.divergence).toBeNull();
        expect(result.current.runError).toBe('engine exploded');
    });
});
