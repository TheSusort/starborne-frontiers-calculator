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
