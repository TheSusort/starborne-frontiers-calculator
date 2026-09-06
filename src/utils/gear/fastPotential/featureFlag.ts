/**
 * USE_FAST_POTENTIAL — when true, routes analyzePotentialUpgrades through
 * fastAnalyzePotentialUpgrades. It IS true, so a test that means to compare
 * the two paths must mock this module false, or it compares the fast path
 * against itself — see `__tests__/equivalence.test.ts`.
 */
export const USE_FAST_POTENTIAL = true;

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
