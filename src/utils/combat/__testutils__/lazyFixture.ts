/**
 * Defers a reference-data-dependent fixture build out of a `describe` BODY.
 *
 * WHY THIS EXISTS (#363 review, Fix 3). Vitest runs every `describe` body during COLLECTION —
 * before any `beforeAll`. A suite whose boards need the gitignored `docs/ship-data.json` /
 * `docs/ship-skills.csv` therefore built them ahead of its own `beforeAll(requireReferenceData)`
 * guard, so in a fresh worktree (a known failure mode in this repo — the reference data is not
 * committed) the file died with an opaque COLLECTION error instead of the readable
 * "docs/… are missing from this worktree" message the guard exists to produce. Collection-time
 * construction also did the work when the tests were filtered out entirely.
 *
 * Wrapping the build in `lazyFixture` moves it to first ACCESS — i.e. inside the first `it` that
 * needs it, which is after `beforeAll` has run — while memoizing so the board is still built
 * exactly once per describe and shared by every arm that reads it (these boards are expensive
 * `runCombat` calls and several arms cross-reference the same run).
 *
 * `undefined` is a legitimate memoized value, so the `built` flag — not a `cached === undefined`
 * check — decides whether the build has happened.
 */
export function lazyFixture<T>(build: () => T): () => T {
    let cached: T;
    let built = false;
    return () => {
        if (!built) {
            cached = build();
            built = true;
        }
        return cached;
    };
}
