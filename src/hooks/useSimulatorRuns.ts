import { useCallback, useEffect, useRef, useState } from 'react';
import type { GearPiece } from '../types/gear';
import type { BattleResult, BattleSimulationInput } from '../utils/calculators/battleSimulator';
import {
    runSeededBattle,
    runSeedSetAsync,
    type SeedSetAggregate,
} from '../utils/simulator/seededRuns';
import { buildTeam } from '../utils/simulator/buildTeam';
import type { CombatStatsDeps } from '../utils/ship/combatStats';
import {
    snapshotOverrides,
    type OverrideSnapshot,
    type PinnedBaseline,
} from '../utils/simulator/compareRuns';
import { effectiveRunParams } from '../utils/simulator/effectiveRunParams';
import type { BoardState } from '../components/simulator/PlacementBoard';
import type { SquadLeaderSelection } from '../utils/combat/preFight';

/** What produced the currently displayed `battleResult`/`aggregate`: the fully-resolved engine
 *  input and the override snapshot at the moment the run started. Frozen at that moment —
 *  neither field is re-derived from live board state afterwards, which is what lets
 *  `handleOpenSeed` and a consumer's override diff stay correct after the boards are edited. */
export interface RunProvenance {
    input: BattleSimulationInput;
    overrides: OverrideSnapshot;
}

interface UseSimulatorRunsArgs {
    playerBoard: BoardState;
    enemyBoard: BoardState;
    statsDeps: CombatStatsDeps;
    playerSquadLeader: SquadLeaderSelection | undefined;
    enemySquadLeader: SquadLeaderSelection | undefined;
    getGearPiece?: (id: string) => GearPiece | undefined;
    seed: number;
    runCount: number;
}

export interface UseSimulatorRunsResult {
    battleResult: BattleResult | null;
    aggregate: SeedSetAggregate | null;
    baseline: PinnedBaseline | null;
    runError: string | null;
    /** The seed/run-count actually in effect — the pinned baseline's while one is pinned,
     *  otherwise the caller's own `seed`/`runCount` (see `effectiveRunParams`). */
    effectiveSeed: number;
    effectiveRunCount: number;
    /** The override snapshot that produced the currently displayed `aggregate`/`battleResult`,
     *  or `null` before any run. Read this instead of snapshotting the live boards — see
     *  `RunProvenance`'s doc. */
    currentOverrides: OverrideSnapshot | null;
    canRun: boolean;
    handleRun: () => void;
    handleOpenSeed: (seed: number) => void;
    handlePinBaseline: () => void;
    handleUnpinBaseline: () => void;
    /** True while a multi-seed run is in flight. A single run is synchronous and clears it. */
    isRunning: boolean;
    /** Completed/total seeds of the run in flight, or `null` when none is. */
    progress: { completed: number; total: number } | null;
    /** Aborts the run in flight. A cancelled run writes no result — see `handleRun`. */
    handleCancel: () => void;
    /** The two fights behind one diverging seed: the pinned baseline's and the current run's,
     *  replayed under the same seed. Mutually exclusive with `battleResult` — the page shows a
     *  pair or a single fight, never both. */
    divergence: { seed: number; baseline: BattleResult; current: BattleResult } | null;
    /** Replays both configurations at `openSeed` and opens them as a pair. */
    handleOpenDivergence: (openSeed: number) => void;
    /** Closes an open pair. Distinct from unpinning — the baseline stays pinned, so the next
     *  diverging seed opens without re-running the seed set (it still replays the two fights). */
    handleCloseDivergence: () => void;
}

/**
 * Owns every piece of state a simulator run produces (`battleResult`, `aggregate`, `baseline`)
 * plus the provenance of whichever one is currently displayed. Board/formation state stays in
 * the page — this hook only reads it to build an engine input and never writes it back.
 */
export function useSimulatorRuns({
    playerBoard,
    enemyBoard,
    statsDeps,
    playerSquadLeader,
    enemySquadLeader,
    getGearPiece,
    seed,
    runCount,
}: UseSimulatorRunsArgs): UseSimulatorRunsResult {
    const [battleResult, setBattleResult] = useState<BattleResult | null>(null);
    const [aggregate, setAggregate] = useState<SeedSetAggregate | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [baseline, setBaseline] = useState<PinnedBaseline | null>(null);
    const [provenance, setProvenance] = useState<RunProvenance | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
    const [divergence, setDivergence] = useState<{
        seed: number;
        baseline: BattleResult;
        current: BattleResult;
    } | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    // Bumped at the start of every handleRun call — sync or async — and on unmount. An async
    // run only writes state while its generation is still current, so starting ANY new run
    // (including the synchronous single-run branch, which writes immediately and never needs
    // to check isCurrent itself) or unmounting supersedes whichever async run is in flight.
    const generationRef = useRef(0);

    useEffect(
        () => () => {
            generationRef.current++;
            abortRef.current?.abort();
        },
        []
    );

    const playerCount = Object.keys(playerBoard).length;
    const enemyCount = Object.keys(enemyBoard).length;
    const canRun = playerCount > 0 && enemyCount > 0;

    const buildInput = (): BattleSimulationInput => ({
        playerTeam: buildTeam(playerBoard, statsDeps),
        enemyTeam: buildTeam(enemyBoard, statsDeps),
        playerSquadLeader,
        enemySquadLeader,
    });

    const { seed: effectiveSeed, runCount: effectiveRunCount } = effectiveRunParams(
        baseline,
        seed,
        runCount
    );

    const handleRun = () => {
        // Guard: simulateBattle throws on an empty side.
        if (!canRun) return;
        setRunError(null);
        // Captured once, up front, so the provenance recorded for this run and the result it
        // produces always describe the SAME boards — never a mix of a stale input and a fresh
        // snapshot (or vice versa) from two separate reads of live state.
        const input = buildInput();
        const overrides = snapshotOverrides(playerBoard, enemyBoard);

        // Every run supersedes whatever is in flight, sync or async: abort the previous
        // controller and bump the generation so a still-running async run's `.then`/`.catch`
        // finds `isCurrent()` false and writes nothing.
        abortRef.current?.abort();
        const generation = ++generationRef.current;
        const isCurrent = () => generation === generationRef.current;

        if (effectiveRunCount === 1) {
            // A single run is synchronous, so it leaves no running state behind for a later
            // async `.then`/`.catch` to clear — clear it here instead.
            setIsRunning(false);
            setProgress(null);
            try {
                setAggregate(null);
                setDivergence(null);
                setBattleResult(runSeededBattle(input, effectiveSeed, getGearPiece));
                setProvenance({ input, overrides });
            } catch (err) {
                setBattleResult(null);
                setAggregate(null);
                setProvenance(null);
                setRunError(err instanceof Error ? err.message : 'Simulation failed');
            }
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;

        setIsRunning(true);
        setProgress({ completed: 0, total: effectiveRunCount });

        void runSeedSetAsync(input, effectiveSeed, effectiveRunCount, {
            getGearPiece,
            signal: controller.signal,
            onProgress: (completed, total) => {
                if (!isCurrent()) return;
                setProgress({ completed, total });
            },
        })
            .then((result) => {
                if (!isCurrent()) return;
                setIsRunning(false);
                setProgress(null);
                // A cancelled run resolves null and writes nothing: whatever is displayed has to
                // stay the recorded run that produced it.
                if (result === null) return;
                setDivergence(null);
                setBattleResult(null);
                setAggregate(result);
                setProvenance({ input, overrides });
            })
            .catch((err) => {
                if (!isCurrent()) return;
                setIsRunning(false);
                setProgress(null);
                setBattleResult(null);
                setAggregate(null);
                setDivergence(null);
                setProvenance(null);
                setRunError(err instanceof Error ? err.message : 'Simulation failed');
            });
    };

    const handleCancel = () => abortRef.current?.abort();

    // Replays one seed from the input that produced the CURRENT aggregate, so the playback
    // always matches the row it was opened from regardless of any board edit made since that
    // run. Never rebuild from the live boards here.
    //
    // Wrapped in useCallback so this stays referentially stable for `SeedSetResults`' memo —
    // see that component's doc for why.
    const handleOpenSeed = useCallback(
        (openSeed: number) => {
            if (!provenance) {
                setRunError('No run to replay yet.');
                return;
            }
            setRunError(null);
            try {
                setDivergence(null);
                setBattleResult(runSeededBattle(provenance.input, openSeed, getGearPiece));
            } catch (err) {
                setBattleResult(null);
                setRunError(err instanceof Error ? err.message : 'Simulation failed');
            }
        },
        [provenance, getGearPiece]
    );

    const handlePinBaseline = () => {
        // A run in flight replaces `aggregate` and `provenance` when it lands, so pinning the
        // currently displayed aggregate would leave the baseline and the current run on
        // different seed sets — and a paired comparison over two different seed sets is not a
        // comparison. `RunComparison` throws rather than render one.
        if (isRunning) return;
        if (!aggregate || !provenance) return;
        setBaseline({ aggregate, overrides: provenance.overrides, input: provenance.input });
    };

    const handleUnpinBaseline = () => {
        setBaseline(null);
        // Without a baseline there is no baseline side to show, so an open pair would be half a
        // comparison.
        setDivergence(null);
    };

    // Replays one seed under BOTH configurations: the pinned baseline's frozen input and the
    // input that produced the current aggregate. `getGearPiece` is threaded into both, because
    // `simulateBattle` resolves gear-derived abilities during the fight rather than reading them
    // off the input — so dropping it on one side would resolve the two fights under different
    // rules.
    const handleOpenDivergence = useCallback(
        (openSeed: number) => {
            if (!baseline) {
                setRunError('Pin a baseline before opening a diverging seed.');
                return;
            }
            if (!provenance) {
                setRunError('No run to replay yet.');
                return;
            }
            setRunError(null);
            try {
                const baselineResult = runSeededBattle(baseline.input, openSeed, getGearPiece);
                const currentResult = runSeededBattle(provenance.input, openSeed, getGearPiece);
                setBattleResult(null);
                setDivergence({ seed: openSeed, baseline: baselineResult, current: currentResult });
            } catch (err) {
                // A failed open leaves nothing displayed: the pair never formed, and the single
                // fight that was on screen is not what the error is about.
                setBattleResult(null);
                setDivergence(null);
                setRunError(err instanceof Error ? err.message : 'Simulation failed');
            }
        },
        [baseline, provenance, getGearPiece]
    );

    const handleCloseDivergence = () => setDivergence(null);

    return {
        battleResult,
        aggregate,
        baseline,
        runError,
        effectiveSeed,
        effectiveRunCount,
        currentOverrides: provenance?.overrides ?? null,
        canRun,
        handleRun,
        handleOpenSeed,
        handlePinBaseline,
        handleUnpinBaseline,
        isRunning,
        progress,
        handleCancel,
        divergence,
        handleOpenDivergence,
        handleCloseDivergence,
    };
}
