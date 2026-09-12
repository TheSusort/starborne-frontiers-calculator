/** Bounds and clamps for the seed/run-count inputs. Kept out of `SeedRunControls.tsx` because a
 *  component module may only export components under `react-refresh/only-export-components`. */

export const MIN_RUN_COUNT = 1;
export const MAX_RUN_COUNT = 200;

/** A run count above `MAX_RUN_COUNT` runs that many synchronous battles on the main thread with
 *  no progress indicator, and `Number('')` (a cleared field) is `0`, which `runSeedSet` rejects.
 *  Clamp to a positive integer in range so the field can never produce either. */
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
