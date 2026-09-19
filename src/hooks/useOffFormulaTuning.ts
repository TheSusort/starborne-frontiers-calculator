import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ship } from '../types/ship';
import type { ShipTypeName } from '../constants/shipTypes';
import type { LimitableStat } from '../types/stats';
import type { GearSuggestion, StatPriority } from '../types/autogear';
import type { CombatStatsDeps } from '../utils/ship/combatStats';
import type { BoardState } from '../components/simulator/PlacementBoard';
import type { Position } from '../types/encounters';
import type { BattleResult } from '../utils/calculators/battleSimulator';
import { sparringOpponents } from '../utils/autogear/simRerank/sparringOpponents';
import { roleObjective } from '../utils/autogear/simRerank/roleObjectives';
import { objectiveSeries, survived } from '../utils/autogear/simRerank/objectiveMetrics';
import {
    bandsBetween,
    bandPriorities,
    classifyOutcome,
    type StatBand,
} from '../utils/autogear/simRerank/statBands';
import type { StatBounds } from '../utils/autogear/simRerank/statBounds';
import { applySuggestionsToShip } from '../utils/autogear/simRerank/candidateShip';
import { focusActorId } from '../utils/autogear/simRerank/runCandidates';
import { buildTeam } from '../utils/simulator/buildTeam';
import { runSeedSetAsync } from '../utils/simulator/seededRuns';

export interface TuningRow {
    band: StatBand;
    /** The stat value this band's optimizer pass actually reached. */
    landed: number;
    /** False when `landed` falls outside `band` — see `bandPriorities` for why a band is a
     *  preference the optimizer may overrule. The panel must show this: where the optimizer
     *  declined a band, and by how much, is part of the measurement. */
    withinBand: boolean;
    /** The role's objective metric, averaged over the seed set, per opponent — index-aligned
     *  with `TuningState.opponents`. */
    byOpponent: number[];
    /** True only if, for every opponent, this band's average constraint value (win rate or
     *  survival rate, per `roleObjective(role).constraint`) is no worse than the baseline's for
     *  that same opponent. A single-metric maximiser can otherwise pick a build that dumps
     *  everything and dies, which this flags rather than hides. */
    constraintHeld: boolean;
    suggestions: GearSuggestion[];
}

/** Autogear's normal, UNBANDED pick for this ship's configured role — `runOptimizer([])`, no
 *  limit on the tuned stat — measured the same way as every band so a row can be compared
 *  against it. This is NOT the ship's equipped gear; it is what a plain "Find optimal gear" run
 *  would suggest today. Not a `TuningRow`: it has no band and no `withinBand`/`constraintHeld`
 *  (there is no band for it to sit inside, and it IS the reference `constraintHeld` compares
 *  every band to). */
export interface TuningBaselineRow {
    landed: number;
    byOpponent: number[];
    suggestions: GearSuggestion[];
}

export interface TuningState {
    status: 'idle' | 'gearing' | 'simulating' | 'done' | 'cancelled' | 'error';
    /** Counted WITHIN the current `status` phase, against that phase's own total: each phase
     *  restarts at 0. Gearing and simulating have different denominators, so a single run-wide
     *  count would have to change meaning mid-run. A reader must show the phase alongside these
     *  two numbers. */
    progress: { completed: number; total: number };
    rows: TuningRow[];
    /** Opponent labels, index-aligned with every row's `byOpponent`. Empty until `status` is
     *  `'done'`: they come from the same single write that delivers `rows` and `baseline`. */
    opponents: string[];
    baseline?: TuningBaselineRow;
    /** Set only when `status` is `'error'`. */
    error?: string;
}

export interface TuningRunArgs {
    ship: Ship;
    /** Never null: `detectOffFormulaStats` returns no findings in Custom mode, so there is
     *  nothing to tune and no "Measure it" control reaches this hook without a role. */
    configuredRole: ShipTypeName;
    stat: LimitableStat;
    gatingStat: 'hacking' | 'security' | 'defence';
    seed: number;
    runCount: number;
    /** Runs one optimizer pass under the given stat priorities and reports the tuned stat's
     *  landed value. INJECTED: building the real `ShipOptimizerConfig` needs the page's
     *  inventory and settings, which this hook has no access to. See
     *  `buildOffFormulaTuningConfig`/`runOffFormulaTuningPass` in `runShipOptimizer.ts`. */
    runOptimizer: (priorities: StatPriority[]) => Promise<{
        suggestions: GearSuggestion[];
        landed: number;
    }>;
    /** The achievable range of `stat` over the pool the optimizer will actually draw from.
     *  INJECTED for the same reason as `runOptimizer` — it is read off that pool, not searched
     *  for. See `statBoundsFromInventory`. */
    statBounds: () => StatBounds;
    deps: CombatStatsDeps;
}

export interface CollectTuningRowsArgs extends TuningRunArgs {
    signal: AbortSignal;
    onProgress: (completed: number, total: number) => void;
    onPhase: (phase: 'gearing' | 'simulating') => void;
}

export interface CollectTuningRowsResult {
    status: 'done' | 'cancelled';
    baseline?: TuningBaselineRow;
    rows: TuningRow[];
    opponents: string[];
}

const CANCELLED: CollectTuningRowsResult = { status: 'cancelled', rows: [], opponents: [] };

interface OpponentMeasurement {
    /** The role's objective metric, one entry per opponent, averaged over the seed set. */
    byOpponent: number[];
    /** The constraint metric (win rate or survival rate), one entry per opponent, averaged over
     *  the seed set. Not part of `TuningRow`'s public shape — only used to compare a band
     *  against the baseline. */
    constraintByOpponent: number[];
}

/**
 * Run one candidate's loadout over every sparring opponent and reduce the role's objective (plus
 * its constraint) to one number per opponent.
 *
 * Goes through `runSeedSetAsync` (for its cancellation/yield behaviour) but reads every seed's
 * full `BattleResult` via `onResult`, not the returned aggregate: `objectiveSeries`/`survived`
 * need round-level fields (`activeDebuffs`, `shieldGranted`, `alive`) that `SeedSetAggregate`
 * does not carry. `focusActorId` still comes from the aggregate — it only reads `roster`, which
 * is identical either way.
 */
async function measureCandidate(
    suggestions: GearSuggestion[],
    ship: Ship,
    playerBoard: BoardState,
    focusPosition: Position,
    opponents: ReturnType<typeof sparringOpponents>['opponents'],
    objective: ReturnType<typeof roleObjective>,
    seed: number,
    runCount: number,
    deps: CombatStatsDeps,
    signal: AbortSignal,
    onOpponentDone: () => void,
    onInnerProgress: (completed: number, total: number) => void
): Promise<OpponentMeasurement | null> {
    const built = applySuggestionsToShip(ship, suggestions);
    const byOpponent: number[] = [];
    const constraintByOpponent: number[] = [];

    for (const opponent of opponents) {
        const candidatePlayerBoard: BoardState = {
            ...playerBoard,
            [focusPosition]: { ...playerBoard[focusPosition], ship: built },
        };

        const results: BattleResult[] = [];
        const aggregate = await runSeedSetAsync(
            {
                playerTeam: buildTeam(candidatePlayerBoard, deps),
                enemyTeam: buildTeam(opponent.enemyBoard, deps),
            },
            seed,
            runCount,
            {
                getGearPiece: deps.getGearPiece,
                signal,
                onResult: (result) => results.push(result),
                onProgress: onInnerProgress,
            }
        );
        if (!aggregate) return null;

        const fid = focusActorId(aggregate, focusPosition);
        let objectiveSum = 0;
        let constraintSum = 0;
        for (const result of results) {
            objectiveSum += objectiveSeries(result, fid, objective.maximise);
            const constraintMet =
                objective.constraint === 'winRate'
                    ? result.outcome.winner === 'player'
                    : survived(result, fid);
            constraintSum += constraintMet ? 1 : 0;
        }
        byOpponent.push(objectiveSum / results.length);
        constraintByOpponent.push(constraintSum / results.length);
        onOpponentDone();
    }

    return { byOpponent, constraintByOpponent };
}

/**
 * Owns the tuning run's sequencing: read the achievable floor and ceiling of `stat` off the
 * eligible pool, band that range, run one optimizer pass per band plus one unconstrained
 * baseline, then replay every
 * resulting build against the three sparring opponents and score each on the role's real
 * objective. A plain function, not hook state, so the sequencing is testable without a renderer
 * — mirrors `collectCandidateRuns` in `useSimRerank.ts`.
 */
export async function collectTuningRows(
    args: CollectTuningRowsArgs
): Promise<CollectTuningRowsResult> {
    const {
        ship,
        configuredRole,
        stat,
        gatingStat,
        seed,
        runCount,
        runOptimizer,
        statBounds,
        deps,
        signal,
        onProgress,
        onPhase,
    } = args;

    const { playerBoard, opponents, focusPosition } = sparringOpponents(ship, gatingStat);
    const objective = roleObjective(configuredRole);

    if (signal.aborted) return CANCELLED;
    const bounds = statBounds();
    // Sorted defensively: `bandsBetween` throws on an inverted range, which would abort the
    // whole run rather than band what there is.
    const bands = bandsBetween(
        Math.min(bounds.floor, bounds.ceiling),
        Math.max(bounds.floor, bounds.ceiling)
    );

    const gearTotal = 1 + bands.length;
    const simTotal = gearTotal * opponents.length;

    onPhase('gearing');
    let gearCompleted = 0;
    const reportGear = () => onProgress(gearCompleted, gearTotal);
    reportGear();

    const baselinePass = await runOptimizer([]);
    if (signal.aborted) return CANCELLED;
    gearCompleted++;
    reportGear();

    const bandPasses: Array<{ band: StatBand; landed: number; suggestions: GearSuggestion[] }> = [];
    for (const band of bands) {
        const pass = await runOptimizer(bandPriorities(stat, band));
        if (signal.aborted) return CANCELLED;
        bandPasses.push({ band, landed: pass.landed, suggestions: pass.suggestions });
        gearCompleted++;
        reportGear();
    }

    onPhase('simulating');
    let simCompleted = 0;
    const reportSim = () => onProgress(simCompleted, simTotal);
    const reportSimInner = (completed: number, total: number) =>
        onProgress(simCompleted + completed / total, simTotal);
    reportSim();

    const measure = (suggestions: GearSuggestion[]) =>
        measureCandidate(
            suggestions,
            ship,
            playerBoard,
            focusPosition,
            opponents,
            objective,
            seed,
            runCount,
            deps,
            signal,
            () => {
                simCompleted++;
                reportSim();
            },
            reportSimInner
        );

    const baselineMeasurement = await measure(baselinePass.suggestions);
    if (!baselineMeasurement) return CANCELLED;

    const rows: TuningRow[] = [];
    for (const pass of bandPasses) {
        const measurement = await measure(pass.suggestions);
        if (!measurement) return CANCELLED;

        const outcome = classifyOutcome(pass.band, pass.landed);
        const constraintHeld = measurement.constraintByOpponent.every(
            (value, i) => value >= baselineMeasurement.constraintByOpponent[i] - 1e-9
        );
        rows.push({
            band: pass.band,
            landed: pass.landed,
            withinBand: outcome.withinBand,
            byOpponent: measurement.byOpponent,
            constraintHeld,
            suggestions: pass.suggestions,
        });
    }

    return {
        status: 'done',
        baseline: {
            landed: baselinePass.landed,
            byOpponent: baselineMeasurement.byOpponent,
            suggestions: baselinePass.suggestions,
        },
        rows,
        opponents: opponents.map((opponent) => opponent.label),
    };
}

const INITIAL_STATE: TuningState = {
    status: 'idle',
    progress: { completed: 0, total: 0 },
    rows: [],
    opponents: [],
};

export interface UseOffFormulaTuningResult {
    state: TuningState;
    run: (args: TuningRunArgs) => Promise<void>;
    cancel: () => void;
    /** Abandons any in-flight run and returns to a fresh idle state without waiting for it to
     *  settle. The panel calls this whenever the run's own context (ship, configured role,
     *  tuned stat, seed, or run count) changes, so a completed table for a PREVIOUS context is
     *  never left on screen — see `useOffFormulaTuning.test.ts`'s context-invalidation case. */
    reset: () => void;
}

/**
 * Owns the tuning run's React state, the `AbortController` that cancels both the optimizer
 * phase and the simulation phase, and the generation counter that stops a superseded or
 * unmounted run from writing state. A run that is no longer the current generation writes
 * nothing at all, so a superseded run can neither overwrite a newer run's rows nor move it out
 * of a running status.
 */
export function useOffFormulaTuning(): UseOffFormulaTuningResult {
    const [state, setState] = useState<TuningState>(INITIAL_STATE);
    const abortRef = useRef<AbortController | null>(null);
    const generationRef = useRef(0);

    useEffect(
        () => () => {
            generationRef.current++;
            abortRef.current?.abort();
        },
        []
    );

    const run = useCallback(async (args: TuningRunArgs) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const generation = ++generationRef.current;
        const isCurrent = () => generation === generationRef.current;

        setState({ ...INITIAL_STATE, status: 'gearing' });

        try {
            const result = await collectTuningRows({
                ...args,
                signal: controller.signal,
                onProgress: (completed, total) => {
                    if (!isCurrent()) return;
                    setState((s) => ({ ...s, progress: { completed, total } }));
                },
                onPhase: (phase) => {
                    if (!isCurrent()) return;
                    setState((s) => ({ ...s, status: phase }));
                },
            });
            if (!isCurrent()) return;

            if (result.status === 'cancelled') {
                setState((s) => ({ ...s, status: 'cancelled' }));
                return;
            }

            setState((s) => ({
                ...s,
                status: 'done',
                rows: result.rows,
                opponents: result.opponents,
                baseline: result.baseline,
            }));
        } catch (err) {
            if (!isCurrent()) return;
            setState({
                ...INITIAL_STATE,
                status: 'error',
                error: err instanceof Error ? err.message : 'Tuning run failed',
            });
        }
    }, []);

    const cancel = useCallback(() => abortRef.current?.abort(), []);

    const reset = useCallback(() => {
        abortRef.current?.abort();
        generationRef.current++;
        setState(INITIAL_STATE);
    }, []);

    return { state, run, cancel, reset };
}
