/**
 * Probabilistic event resolution for the combat engine and DPS/healing calculators:
 * crit, debuff landing (hacking vs security), charge manipulation, proc chances, and
 * counter crits all flow through these gates.
 *
 * Each draw is a real random sample: a gate fires when `rng() < rate`, so a 70% rate
 * fires ~70% of the time with natural variance (no back-loading — the first hit can
 * crit). Rates are clamped to [0, 1]; rate >= 1 always fires (rng() is [0,1)), rate <= 0
 * never fires.
 *
 * `rng` defaults to `Math.random`, so an ordinary fight is a real random sample. Callers that
 * need a reproducible fight install a seeded stream for the duration of one run via
 * `setupKeyedRng` and restore the default afterwards — `src/setupTests.ts` does this per
 * test, and `src/utils/simulator/seededRuns.ts` does it per seeded run in the app.
 */

/** The active RNG: the default stream (`Math.random`) until a caller installs a seeded one. */
let rng: () => number = Math.random;

/** Overrides the RNG used by all unkeyed gates. The caller owns restoring the default
 *  (see `resetRateGateRng`). */
export function setRateGateRng(fn: () => number): void {
    rng = fn;
}

/**
 * Restore the default `Math.random` RNG, clearing both the shared and the keyed stream.
 *
 * ⚠️ ORDER MATTERS. This clears BOTH streams — `rng` and `keyedProvider` — so calling it *after*
 * `setupKeyedRng` un-seeds the caller and hands it true randomness, silently. It belongs in an
 * `afterEach` or a `finally`, never on the line after a seed. In a test file it is usually
 * redundant anyway: `src/setupTests.ts` already resets after every test.
 * Enforced by `rateGateSeedingOrder.test.ts`.
 */
export function resetRateGateRng(): void {
    rng = Math.random;
    keyedProvider = null;
}

/** The keyed sub-stream provider. Null until a caller installs one (`setKeyedRng`) — with
 *  no provider installed, a keyed gate falls back to the shared `rng`. */
let keyedProvider: ((key: string) => number) | null = null;

/** Installs (or, given `null`, clears) the keyed sub-stream provider used by gates created
 *  with a `streamKey`. */
export function setKeyedRng(provider: ((key: string) => number) | null): void {
    keyedProvider = provider;
}

/** FNV-1a string hash → 32-bit seed offset, so each key deterministically seeds its own stream. */
function hashKey(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Build a keyed RNG: lazily mints one mulberry32 sub-stream per key, seeded from base ^ hash(key). */
export function makeKeyedRng(baseSeed: number): (key: string) => number {
    const streams = new Map<string, () => number>();
    return (key: string): number => {
        let s = streams.get(key);
        if (!s) {
            s = mulberry32((baseSeed ^ hashKey(key)) >>> 0);
            streams.set(key, s);
        }
        return s();
    };
}

/** Installs a seeded stream for both the shared `rng` (unkeyed gates) and a keyed provider
 *  seeded from the same base seed (keyed gates), so every gate the caller reaches draws from
 *  one seed. `src/setupTests.ts` calls this per test; `src/utils/simulator/seededRuns.ts`
 *  calls it per seeded run in the app. The caller restores the default via
 *  `resetRateGateRng` when it is done — see the ordering hazard on that function. */
export function setupKeyedRng(seed: number): void {
    setRateGateRng(mulberry32(seed));
    setKeyedRng(makeKeyedRng(seed));
}

/** Deterministic, seedable PRNG (mulberry32). The engine's only seeded stream: every gate
 *  draw that isn't the default `Math.random` traces back to a `mulberry32` instance minted
 *  by `setupKeyedRng` or `makeKeyedRng`. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Returns a gate closure: `gate(rate)` is true with probability `rate` (a fresh random
 * draw per call). The closure reads the live module `rng` at call time, so a mid-run
 * `setRateGateRng` takes effect on gates created earlier — the mechanism a caller relies on
 * to seed a fight that is already in progress.
 *
 * Each `makeRateGate()` returns its own closure for signature compatibility with the
 * engine's many gate instances; the closures are stateless and draw independently.
 *
 * `streamKey` is optional: when supplied AND a keyed provider is installed (via
 * `setKeyedRng`), the draw comes from that key's own sub-stream instead of the shared
 * `rng`. With no keyed provider installed — the default stream — the key is ignored and the
 * gate falls back to `rng()` exactly as before.
 */
export function makeRateGate(streamKey?: string): (rate: number) => boolean {
    return (rate: number): boolean => {
        const draw = streamKey != null && keyedProvider != null ? keyedProvider(streamKey) : rng();
        return draw < Math.min(1, Math.max(0, rate));
    };
}

/** Get-or-create a per-key gate in `gates` and roll it at `chance`. Absent map → pass-through
 *  (true). Backs the engine's per-(owner,ability) proc closures. The per-key map exists for
 *  call-site compatibility; the gates it stores are stateless and draw independently
 *  regardless of key. */
export function rollRateGate(
    gates: Map<string, ReturnType<typeof makeRateGate>> | undefined,
    key: string,
    chance: number
): boolean {
    if (!gates) return true;
    let gate = gates.get(key);
    if (!gate) {
        // `key` is already the caller's per-(owner,ability) map key (e.g. `${rid}:${abilityId}`,
        // `${ownerId}:${abilityId}`) — reuse it verbatim as the stream key so each owner draws
        // from its own sub-stream when a keyed provider is installed.
        gate = makeRateGate(key);
        gates.set(key, gate);
    }
    return gate(chance);
}
