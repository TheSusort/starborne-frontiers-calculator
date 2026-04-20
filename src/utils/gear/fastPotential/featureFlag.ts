/**
 * USE_FAST_POTENTIAL — when true, routes analyzePotentialUpgrades through
 * fastAnalyzePotentialUpgrades. Defaults to false on first merge; flipped in
 * Phase 5 once equivalence tests and user-side benchmarks look good.
 */
export const USE_FAST_POTENTIAL = false;

/**
 * VERIFY_FAST_POTENTIAL — when true, runs BOTH paths per call and
 * console.errors on divergence. The production answer is still the slow
 * path; the fast result is only compared. Dev-only; flip to `true` locally
 * to debug.
 *
 * Module-level literal const so Vite tree-shakes the verify branch in
 * production builds.
 */
export const VERIFY_FAST_POTENTIAL = false;
