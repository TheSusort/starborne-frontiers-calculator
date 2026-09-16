import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ship } from '../types/ship';
import type { GearSuggestion } from '../types/autogear';
import type { AutogearResult } from '../utils/autogear/AutogearStrategy';
import type { ShipTypeName } from '../constants/shipTypes';
import type { CombatStatsDeps } from '../utils/ship/combatStats';
import type { DroppedCell } from '../utils/simulator/simulatorSetup';
import { applySuggestionsToShip } from '../utils/autogear/simRerank/candidateShip';
import { stolenFromBoard, type StolenPiece } from '../utils/autogear/simRerank/gearSteal';
import {
    resolveFight,
    type FightBoards,
    type FightSource,
} from '../utils/autogear/simRerank/fightSources';
import { runCandidate, type CandidateRun } from '../utils/autogear/simRerank/runCandidates';
import { buildMetricTable, type CandidateRow } from '../utils/autogear/simRerank/metricTable';

/** A loadout's standing within its role's autogear pass: the optimizer's best suggestion, or one
 *  of its distinct runner-ups (1-indexed). Structured so a consumer can branch on standing without
 *  parsing a display string — building the player-facing label (e.g. via `SHIP_TYPES[role].name`)
 *  is the UI's job, not this hook's. */
export type CandidateRank = 'best' | { alt: number };

export interface SimRerankRow {
    id: string;
    role: ShipTypeName;
    rank: CandidateRank;
    run: CandidateRun;
    /** The gear this row's build wears. Lets a consumer equip the row (via
     *  `applySuggestionsToShip`) without re-deriving it from `role`/`rank`. */
    loadout: GearSuggestion[];
}

export interface ExcludedCandidate {
    role: ShipTypeName;
    rank: CandidateRank;
    stripped: StolenPiece[];
}

export interface SimRerankState {
    status: 'idle' | 'gearing' | 'simulating' | 'done' | 'cancelled';
    progress: { completed: number; total: number };
    baseline?: CandidateRun;
    rows: SimRerankRow[];
    table: CandidateRow[];
    excluded: ExcludedCandidate[];
    /** True when autogear's own best was excluded — stated, not buried in a count. */
    ownBestExcluded: boolean;
    /** Cells the resolved fight dropped. Mirrors `FightBoards.dropped` so a later UI can tell the
     *  player the comparison did not run the fight they saved. */
    dropped: DroppedCell[];
    /** Set only alongside a status that was just reset to `'idle'` with rows/table/baseline
     *  cleared; never appears together with any other status. */
    error?: string;
}

export interface SimRerankRunArgs {
    focus: Ship;
    source: FightSource;
    comparedRoles: ShipTypeName[];
    seed: number;
    runCount: number;
    deps: CombatStatsDeps;
    getShipById: (id: string) => Ship | undefined;
    gearToShipMap: Map<string, string>;
    resolveShip: (shipId: string) => Ship | null;
    /** Runs the configured autogear strategy under one role. INJECTED, not imported: the
     *  optimizer is CPU-bound and main-thread, and the page already owns every input it needs
     *  (inventory, priorities, settings). Passing it keeps this hook testable without one. */
    runAutogearFor: (role: ShipTypeName) => Promise<AutogearResult>;
}

const INITIAL_STATE: SimRerankState = {
    status: 'idle',
    progress: { completed: 0, total: 0 },
    rows: [],
    table: [],
    excluded: [],
    ownBestExcluded: false,
    dropped: [],
};

/** Swap the ship fighting at the focus's cell, leaving every other cell untouched. Used to put a
 *  candidate build (or the equipped ship) into an otherwise-fixed fight without re-resolving the
 *  source (which would re-run setup deserialization or formation lookups for no reason — the
 *  board composition never changes across candidates, only the focus's own gear does). */
function withFocusShip(fight: FightBoards, ship: Ship): FightBoards {
    const cell = fight.playerBoard[fight.focusPosition];
    return {
        ...fight,
        playerBoard: {
            ...fight.playerBoard,
            [fight.focusPosition]: { ...cell, ship },
        },
    };
}

interface PendingCandidate {
    id: string;
    role: ShipTypeName;
    rank: CandidateRank;
    ship: Ship;
    loadout: GearSuggestion[];
}

/** One loadout a role's autogear pass produced: the best suggestion, or one of the genetic
 *  strategy's distinct runner-ups. */
interface Loadout {
    role: ShipTypeName;
    rank: CandidateRank;
    suggestions: GearSuggestion[];
}

const loadoutsFor = (role: ShipTypeName, result: AutogearResult): Loadout[] => [
    { role, rank: 'best', suggestions: result.suggestions },
    ...(result.candidates ?? []).map((suggestions, index) => ({
        role,
        rank: { alt: index + 1 },
        suggestions,
    })),
];

/** A React-key-stable id for one loadout. Carries no display text — `role`/`rank` on the row are
 *  the identity a consumer branches on. */
const candidateId = (role: ShipTypeName, rank: CandidateRank): string =>
    rank === 'best' ? `${role}:best` : `${role}:alt:${rank.alt}`;

export interface CollectCandidateRunsArgs extends SimRerankRunArgs {
    signal: AbortSignal;
    onProgress: (completed: number, total: number) => void;
    onPhase: (phase: 'gearing' | 'simulating') => void;
}

export interface CollectCandidateRunsResult {
    status: 'done' | 'cancelled';
    baseline?: CandidateRun;
    rows: SimRerankRow[];
    table: CandidateRow[];
    excluded: ExcludedCandidate[];
    ownBestExcluded: boolean;
    dropped: DroppedCell[];
}

const CANCELLED: CollectCandidateRunsResult = {
    status: 'cancelled',
    rows: [],
    table: [],
    excluded: [],
    ownBestExcluded: false,
    dropped: [],
};

/**
 * Run one ship's own role plus every compared role through the injected optimizer, drop any
 * candidate that would take gear off a ship standing on the fight board, then run every survivor
 * plus the equipped baseline through the combat simulator over one shared seed set.
 *
 * A plain function rather than hook state: the interesting sequencing — which loadouts get built,
 * which get excluded, which order they simulate in — is then testable without a renderer. The
 * hook wraps this only with React state and the `AbortController` that feeds `signal`.
 */
export async function collectCandidateRuns(
    args: CollectCandidateRunsArgs
): Promise<CollectCandidateRunsResult> {
    const {
        focus,
        source,
        comparedRoles,
        seed,
        runCount,
        deps,
        getShipById,
        gearToShipMap,
        resolveShip,
        runAutogearFor,
        signal,
        onProgress,
        onPhase,
    } = args;

    const fight = resolveFight(source, focus, resolveShip);

    // The ship's own role goes first; a role already present among the caller's compared roles
    // is not re-run.
    const roles: ShipTypeName[] = [];
    for (const role of [focus.type, ...comparedRoles]) {
        if (!roles.includes(role)) roles.push(role);
    }

    const pending: PendingCandidate[] = [];
    const excluded: ExcludedCandidate[] = [];
    let ownBestExcluded = false;

    onPhase('gearing');
    onProgress(0, roles.length);

    for (let i = 0; i < roles.length; i++) {
        if (signal.aborted) return CANCELLED;
        const role = roles[i];
        const result = await runAutogearFor(role);
        if (signal.aborted) return CANCELLED;

        for (const loadout of loadoutsFor(role, result)) {
            const stripped = stolenFromBoard({
                suggestions: loadout.suggestions,
                focusShipId: focus.id,
                boardShipIds: fight.boardShipIds,
                getShipById,
                gearToShipMap,
            });
            if (stripped.length > 0) {
                excluded.push({ role: loadout.role, rank: loadout.rank, stripped });
                if (loadout.rank === 'best' && role === focus.type) ownBestExcluded = true;
                continue;
            }
            pending.push({
                id: candidateId(loadout.role, loadout.rank),
                role: loadout.role,
                rank: loadout.rank,
                ship: applySuggestionsToShip(focus, loadout.suggestions),
                loadout: loadout.suggestions,
            });
        }

        onProgress(i + 1, roles.length);
    }

    onPhase('simulating');

    // Survivors plus the equipped baseline. The denominator grows once gearing finishes and the
    // survivor count is known — a coarse-then-refined total, not a promise of stability.
    const simTotal = pending.length + 1;
    let simCompleted = 0;
    const reportSimProgress = () =>
        onProgress(roles.length + simCompleted, roles.length + simTotal);
    reportSimProgress();
    // Advances the same overall counter mid-candidate, using the seed set's own completed/total —
    // otherwise the bar holds still for the whole of a long candidate's run.
    const reportInnerProgress = (completed: number, total: number) =>
        onProgress(roles.length + simCompleted + completed / total, roles.length + simTotal);

    const baseline = await runCandidate({
        id: 'equipped',
        fight,
        deps,
        seed,
        runCount,
        signal,
        onProgress: reportInnerProgress,
    });
    if (!baseline) return CANCELLED;
    simCompleted++;
    reportSimProgress();

    const rows: SimRerankRow[] = [];
    for (const candidate of pending) {
        const run = await runCandidate({
            id: candidate.id,
            fight: withFocusShip(fight, candidate.ship),
            deps,
            seed,
            runCount,
            signal,
            onProgress: reportInnerProgress,
        });
        if (!run) return CANCELLED;
        rows.push({
            id: candidate.id,
            role: candidate.role,
            rank: candidate.rank,
            run,
            loadout: candidate.loadout,
        });
        simCompleted++;
        reportSimProgress();
    }

    return {
        status: 'done',
        baseline,
        rows,
        table: buildMetricTable(
            baseline,
            rows.map((row) => row.run)
        ),
        excluded,
        ownBestExcluded,
        dropped: fight.dropped,
    };
}

export interface UseSimRerankResult {
    state: SimRerankState;
    run: (args: SimRerankRunArgs) => Promise<void>;
    cancel: () => void;
    reset: () => void;
}

/**
 * Owns the candidate-comparison run: React state plus the `AbortController` that cancels both the
 * optimizer phase and the simulation phase. All sequencing lives in `collectCandidateRuns`.
 *
 * A cancelled or errored run resets to a fresh idle-shaped state rather than keeping a previous
 * result on screen — this comparison has no notion of "stale but still useful," unlike a sweep's
 * last-good chart, because a candidate's build depends on the exact inputs the next run may
 * change.
 */
export function useSimRerank(): UseSimRerankResult {
    const [state, setState] = useState<SimRerankState>(INITIAL_STATE);
    const abortRef = useRef<AbortController | null>(null);
    // Bumped at the start of every run and on unmount, so a superseded or unmounted run's
    // eventual resolution never writes state.
    const generationRef = useRef(0);

    useEffect(
        () => () => {
            generationRef.current++;
            abortRef.current?.abort();
        },
        []
    );

    const run = useCallback(async (args: SimRerankRunArgs) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const generation = ++generationRef.current;
        const isCurrent = () => generation === generationRef.current;

        setState({ ...INITIAL_STATE, status: 'gearing' });

        try {
            const result = await collectCandidateRuns({
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
                baseline: result.baseline,
                rows: result.rows,
                table: result.table,
                excluded: result.excluded,
                ownBestExcluded: result.ownBestExcluded,
                dropped: result.dropped,
            }));
        } catch (err) {
            if (!isCurrent()) return;
            setState({
                ...INITIAL_STATE,
                error: err instanceof Error ? err.message : 'Comparison failed',
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
