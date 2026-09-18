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
    probePriorities,
    bandsBetween,
    bandPriorities,
    classifyOutcome,
    type StatBand,
} from '../utils/autogear/simRerank/statBands';
import { applySuggestionsToShip } from '../utils/autogear/simRerank/candidateShip';
import { focusActorId } from '../utils/autogear/simRerank/runCandidates';
import { buildTeam } from '../utils/simulator/buildTeam';
import { runSeedSetAsync } from '../utils/simulator/seededRuns';

/** Pins the ceiling probe far past anything a real build reaches, so the optimizer's nearest
 *  feasible answer is the inventory's true maximum for the tuned stat. `calculateHardViolation`
 *  normalizes by the limit (floored at 1), so this is unreachable-large without risking overflow
 *  or a divide-by-zero the way a literal 0 ceiling would. */
const CEILING_PROBE_VALUE = 1e9;

export interface TuningRow {
    band: StatBand;
    /** The stat value this band's optimizer pass actually reached. */
    landed: number;
    /** False when `landed` falls outside `band` — see `classifyOutcome`. The panel must show
     *  this rather than presenting the row as a normal result: the optimizer returns the
     *  nearest feasible build with no other signal that the band was unreachable. */
    reachable: boolean;
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
 *  would suggest today. Not a `TuningRow`: it has no band and no `reachable`/`constraintHeld`
 *  (nothing to be unreachable against, and it IS the reference `constraintHeld` compares every
 *  band to). */
export interface TuningBaselineRow {
    landed: number;
    byOpponent: number[];
    suggestions: GearSuggestion[];
}

export interface TuningState {
    status: 'idle' | 'probing' | 'gearing' | 'simulating' | 'done' | 'cancelled';
    progress: { completed: number; total: number };
    rows: TuningRow[];
    /** Opponent labels, index-aligned with every row's `byOpponent`. Empty until `status` is
     *  `'done'` — the hook only writes state once, on completion, matching every other field
     *  here. */
    opponents: string[];
    baseline?: TuningBaselineRow;
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
     *  inventory/settings, and forcing `AutogearAlgorithm.Genetic` — required because
     *  `hardRequirement` is honoured only by `GeneticStrategy` — belongs at that injection site,
     *  not in this hook. See `buildOffFormulaTuningConfig`/`runOffFormulaTuningPass` in
     *  `runShipOptimizer.ts`. */
    runOptimizer: (priorities: StatPriority[]) => Promise<{
        suggestions: GearSuggestion[];
        landed: number;
    }>;
    deps: CombatStatsDeps;
}

export interface CollectTuningRowsArgs extends TuningRunArgs {
    signal: AbortSignal;
    onProgress: (completed: number, total: number) => void;
    onPhase: (phase: 'probing' | 'gearing' | 'simulating') => void;
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
 * Owns the tuning run's sequencing: probe the achievable floor and ceiling of `stat`, band that
 * range, run one optimizer pass per band plus one unconstrained baseline, then replay every
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
        deps,
        signal,
        onProgress,
        onPhase,
    } = args;

    const { playerBoard, opponents, focusPosition } = sparringOpponents(ship, gatingStat);
    const objective = roleObjective(configuredRole);

    onPhase('probing');
    onProgress(0, 2);
    if (signal.aborted) return CANCELLED;
    const floorPass = await runOptimizer(probePriorities(stat, 0));
    if (signal.aborted) return CANCELLED;
    onProgress(1, 2);
    const ceilingPass = await runOptimizer(probePriorities(stat, CEILING_PROBE_VALUE));
    if (signal.aborted) return CANCELLED;
    onProgress(2, 2);

    // Sorted defensively: the genetic algorithm is stochastic, and a pathological inventory
    // could in principle land the ceiling probe below the floor probe. bandsBetween throws on
    // an inverted range, which would abort the whole run over what is really just noise.
    const floor = Math.min(floorPass.landed, ceilingPass.landed);
    const ceiling = Math.max(floorPass.landed, ceilingPass.landed);
    const bands = bandsBetween(floor, ceiling);

    const gearTotal = 1 + bands.length;
    const simTotal = gearTotal * opponents.length;
    const overallTotal = 2 + gearTotal + simTotal;

    onPhase('gearing');
    let gearCompleted = 0;
    const reportGear = () => onProgress(2 + gearCompleted, overallTotal);
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
    const reportSim = () => onProgress(2 + gearTotal + simCompleted, overallTotal);
    const reportSimInner = (completed: number, total: number) =>
        onProgress(2 + gearTotal + simCompleted + completed / total, overallTotal);
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
            reachable: outcome.reachable,
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
 * unmounted run from writing state. Copied verbatim from `useSimRerank.ts`, which this mirrors
 * deliberately — that hook's generation/abort handling is already reviewed.
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

        setState({ ...INITIAL_STATE, status: 'probing' });

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
