/**
 * USE_FAST_SCORING — controls whether GeneticStrategy uses the fast-path
 * scoring module or the existing calculateTotalScore. Flipped on once
 * equivalence tests and benchmarks look good.
 *
 * Defaults to false on first merge; flip to true in Task 16.
 */
export const USE_FAST_SCORING = false;

/**
 * VERIFY_FAST_SCORING — when true, the GA runs BOTH the fast path and the
 * slow path on every fitness eval and console.errors on divergence.
 *
 * Set to a literal `true` locally to debug; revert to `false` before commit.
 * Kept as a module-level constant (not an env-var read) so Vite can dead-code
 * eliminate the verify branch in production builds.
 */
export const VERIFY_FAST_SCORING = false;
