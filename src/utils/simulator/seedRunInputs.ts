/** Bounds and clamps for the seed/run-count inputs. Kept out of `SeedRunControls.tsx` because a
 *  component module may only export components under `react-refresh/only-export-components`. */

export const MIN_RUN_COUNT = 1;
export const MAX_RUN_COUNT = 1000;

/** `Number('')` from a cleared field is `0`, which a seed-set run rejects, and a fractional or
 *  non-finite value is not a run count at all. Clamp to a positive integer in range so the field
 *  can never produce one. The ceiling bounds how long a run can take, not whether it can be
 *  escaped — a multi-seed run yields between seeds and can be cancelled. */
export function clampRunCount(value: number): number {
    if (!Number.isFinite(value)) return MIN_RUN_COUNT;
    return Math.min(MAX_RUN_COUNT, Math.max(MIN_RUN_COUNT, Math.round(value)));
}

/** Mulberry32 (the engine's seeded RNG) takes any 32-bit integer, so 0 is not a degenerate seed
 *  — this only rejects non-finite input and keeps the value inside a safe 32-bit range. */
export function clampSeed(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(Math.min(2 ** 31 - 1, Math.max(0, value)));
}
