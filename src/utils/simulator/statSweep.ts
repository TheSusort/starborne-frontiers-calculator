import type { Position } from '../../types/encounters';
import type { GearPiece } from '../../types/gear';
import type { BattlePlacement, BattleSimulationInput } from '../calculators/battleSimulator';
import { runSeedSetAsync, type SeedSetAggregate } from './seededRuns';
import { OVERRIDE_MIN, type OverridableStat } from './statOverrides';

/** Cost is multiplicative — steps x seeds battles — so an uncapped range at `step: 1` would queue
 *  millions. */
export const MAX_SWEEP_STEPS = 25;

export interface SweepStep {
    value: number;
    /** The step at the target's currently resolved value. Exactly one step carries it: every
     *  reading in a sweep is a difference FROM where the ship actually sits. */
    isReference: boolean;
}

/**
 * The values one sweep visits, ascending, with the resolved value always among them.
 *
 * Throws rather than clamps on an unusable range: these values flow straight into
 * `statOverrides`, where a NaN or a below-floor figure produces a meaningless fight with no
 * error.
 */
export function sweepSteps(
    stat: OverridableStat,
    from: number,
    to: number,
    step: number,
    resolved: number
): SweepStep[] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) {
        throw new Error('sweep range must be finite');
    }
    if (step <= 0) throw new Error('sweep step must be positive');

    const start = Math.round(from);
    const end = Math.round(to);
    const increment = Math.max(1, Math.round(step));
    if (start > end) throw new Error('sweep range must run from a lower value to a higher one');

    const floor = OVERRIDE_MIN[stat] ?? 0;
    if (start < floor) throw new Error(`${stat} has a floor of ${floor}`);

    // Counted BEFORE the loop: `from: 0, to: 1e9, step: 1` is one keystroke away in a number
    // field, and discovering the cap by iterating to it freezes the page first.
    const plannedSteps = Math.floor((end - start) / increment) + 1;
    if (plannedSteps > MAX_SWEEP_STEPS) {
        throw new Error(`a sweep runs at most ${MAX_SWEEP_STEPS} steps`);
    }

    const reference = Math.round(resolved);
    const values = new Set<number>();
    for (let value = start; value <= end; value += increment) values.add(value);
    if (reference >= floor) values.add(reference);

    // The reference can add one past the planned count.
    if (values.size > MAX_SWEEP_STEPS) {
        throw new Error(`a sweep runs at most ${MAX_SWEEP_STEPS} steps`);
    }

    return [...values]
        .sort((a, b) => a - b)
        .map((value) => ({ value, isReference: value === reference }));
}

export interface SweepTarget {
    side: 'player' | 'enemy';
    position: Position;
}

export interface SweepStepResult {
    value: number;
    isReference: boolean;
    aggregate: SeedSetAggregate;
}

export interface SweepResult {
    stat: OverridableStat;
    target: SweepTarget;
    baseSeed: number;
    count: number;
    steps: SweepStepResult[];
}

/**
 * One step's engine input: the given input with a single stat changed on a single placement.
 *
 * The placement is found by `position`, not by array index, so the lookup does not depend on
 * `buildTeam`'s ordering. Every other placement is carried over as the same object — a step is
 * one number changed, not a rebuild, and `buildTeam` has already baked resolved stats in.
 *
 * A value equal to the placement's resolved base is written, not dropped. `normalizeOverride`
 * drops it (storing a no-op override would make the editor's badge report a change that does not
 * exist); here it is the reference step every other step is measured against.
 */
export function stepInput(
    input: BattleSimulationInput,
    target: SweepTarget,
    stat: OverridableStat,
    value: number
): BattleSimulationInput {
    const key = target.side === 'player' ? 'playerTeam' : 'enemyTeam';
    const team = input[key];
    const index = team.findIndex((placement) => placement.position === target.position);
    if (index < 0) {
        throw new Error(`no ${target.side} placement at ${target.position}`);
    }
    const next: BattlePlacement[] = [...team];
    const placement = team[index];
    next[index] = {
        ...placement,
        statOverrides: { ...placement.statOverrides, [stat]: value },
    };
    return { ...input, [key]: next };
}

export interface StatSweepOptions {
    getGearPiece?: (id: string) => GearPiece | undefined;
    signal?: AbortSignal;
    /** `(completedBattles, totalBattles)` — battles, not steps, so the bar advances within a
     *  step and not only between them. */
    onProgress?: (completed: number, total: number) => void;
}

/**
 * Run one seed set per step and collect the aggregates.
 *
 * Every step uses the same `baseSeed` and `count`. Steps run over different seed sets are
 * unpaired while still presenting themselves as comparable — the same rule `effectiveRunParams`
 * enforces for a pinned baseline.
 *
 * Resolves `null` when the signal aborts — never a partial sweep, for the same reason
 * `runSeedSetAsync` never returns a partial aggregate: a caller must not be able to display a
 * result that was not produced.
 */
export async function runStatSweepAsync(
    input: BattleSimulationInput,
    target: SweepTarget,
    stat: OverridableStat,
    steps: SweepStep[],
    baseSeed: number,
    count: number,
    options: StatSweepOptions = {}
): Promise<SweepResult | null> {
    const { getGearPiece, signal, onProgress } = options;
    const totalBattles = steps.length * count;
    const results: SweepStepResult[] = [];

    for (const [index, step] of steps.entries()) {
        if (signal?.aborted) return null;
        const completedBefore = index * count;
        const aggregate = await runSeedSetAsync(
            stepInput(input, target, stat, step.value),
            baseSeed,
            count,
            {
                getGearPiece,
                signal,
                onProgress: (completed) => onProgress?.(completedBefore + completed, totalBattles),
            }
        );
        if (aggregate === null) return null;
        results.push({ value: step.value, isReference: step.isReference, aggregate });
    }

    if (signal?.aborted) return null;
    return { stat, target, baseSeed, count, steps: results };
}
