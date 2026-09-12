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
const mockRunSeedSet = vi.fn((...args: unknown[]) =>
    fakeAggregate(args[1] as number, args[2] as number)
);

vi.mock('../../utils/simulator/seededRuns', () => ({
    runSeededBattle: (...args: unknown[]) => mockRunSeededBattle(...args),
    runSeedSet: (...args: unknown[]) => mockRunSeedSet(...args),
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

describe('useSimulatorRuns', () => {
    beforeEach(() => {
        mockRunSeededBattle.mockClear();
        mockRunSeedSet.mockClear();
    });

    it('editing a board after a run does not change the recorded provenance, and a reopened seed replays the frozen input', () => {
        const initialPlayerBoard = board('T1', 'nova', { attack: 100 });
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ playerBoard: initialPlayerBoard, runCount: 3 }) }
        );

        act(() => result.current.handleRun());

        const runInput = mockRunSeedSet.mock.calls[0][0];
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

    it('running again after a board edit refreshes the recorded provenance to the edited snapshot', () => {
        const initialPlayerBoard = board('T1', 'nova', { attack: 100 });
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ playerBoard: initialPlayerBoard, runCount: 3 }) }
        );

        act(() => result.current.handleRun());
        const firstRunOverrides = result.current.currentOverrides;

        // Edit the board, then run again (as opposed to the frozen-provenance test above, which
        // never re-runs after the edit).
        const editedPlayerBoard = board('T1', 'nova', { attack: 400 });
        rerender(baseArgs({ playerBoard: editedPlayerBoard, runCount: 3 }));
        act(() => result.current.handleRun());

        expect(result.current.currentOverrides).toEqual(
            snapshotOverrides(editedPlayerBoard, baseArgs().enemyBoard)
        );
        expect(result.current.currentOverrides).not.toEqual(firstRunOverrides);
    });

    it('a run while a baseline is pinned uses the baseline seed and count, ignoring the caller-supplied seed/runCount', () => {
        const { result, rerender } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs({ seed: 42, runCount: 5 }) }
        );

        act(() => result.current.handleRun());
        act(() => result.current.handlePinBaseline());
        expect(result.current.baseline).not.toBeNull();

        // The page's own seed/runCount change (e.g. the user typed a new value into a now-locked
        // field) — the hook must still resolve to the baseline's seed set.
        rerender(baseArgs({ seed: 99, runCount: 10 }));
        expect(result.current.effectiveSeed).toBe(42);
        expect(result.current.effectiveRunCount).toBe(5);

        act(() => result.current.handleRun());
        const lastCall = mockRunSeedSet.mock.calls[mockRunSeedSet.mock.calls.length - 1];
        expect(lastCall[1]).toBe(42);
        expect(lastCall[2]).toBe(5);
    });

    it('pinning then re-running preserves the baseline (a new aggregate does not replace it)', () => {
        const { result } = renderHook(
            (props: Parameters<typeof useSimulatorRuns>[0]) => useSimulatorRuns(props),
            { initialProps: baseArgs() }
        );

        act(() => result.current.handleRun());
        act(() => result.current.handlePinBaseline());
        const pinnedBaseline = result.current.baseline;
        expect(pinnedBaseline).not.toBeNull();

        act(() => result.current.handleRun());
        expect(result.current.baseline).toBe(pinnedBaseline);
        // The new run produced its own aggregate object, distinct from the pinned one.
        expect(result.current.aggregate).not.toBe(pinnedBaseline?.aggregate);
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
});
