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
 * `rng` defaults to `Math.random` (production is truly random, no seed). Tests override
 * it via `setRateGateRng` — `src/setupTests.ts` installs a seeded mulberry32 per test so
 * the suite (including golden snapshots) stays deterministic. Production never calls the
 * setters.
 */

/** The active RNG. Production leaves this as Math.random; tests override it. */
let rng: () => number = Math.random;

/** Test-only: override the RNG used by all gates. Never called in production. */
export function setRateGateRng(fn: () => number): void {
    rng = fn;
}

/** Test-only: restore the default Math.random RNG. */
export function resetRateGateRng(): void {
    rng = Math.random;
    keyedProvider = null;
}

/** Installed only by the test bootstrap. Null in production → keyed gates fall back to `rng`. */
let keyedProvider: ((key: string) => number) | null = null;

/** Test-only: install (or clear) the keyed sub-stream provider. */
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

/** Test-only: install both the shared seeded rng (unkeyed gates) and a keyed provider
 *  seeded from the same base seed (keyed gates), so every test runs with both streams
 *  available. Called only from `src/setupTests.ts` — never in production. */
export function setupKeyedTestRng(seed: number): void {
    setRateGateRng(mulberry32(seed));
    setKeyedRng(makeKeyedRng(seed));
}

/** Deterministic, seedable PRNG (mulberry32). Used by the test bootstrap to make the
 *  suite reproducible; not used in production. */
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
 * `setRateGateRng` takes effect on gates created earlier (used by tests).
 *
 * Each `makeRateGate()` returns its own closure for signature compatibility with the
 * engine's many gate instances; the closures are stateless and draw independently.
 *
 * `streamKey` is optional and test-only: when supplied AND a keyed provider is installed
 * (via `setKeyedRng`), the draw comes from that key's own sub-stream instead of the
 * shared `rng`. With no keyed provider installed (production), behavior is unchanged —
 * the key is ignored and the gate falls back to `rng()` exactly as before.
 */
export function makeRateGate(streamKey?: string): (rate: number) => boolean {
    return (rate: number): boolean => {
        const draw =
            streamKey != null && keyedProvider != null ? keyedProvider(streamKey) : rng();
        return draw < Math.min(1, Math.max(0, rate));
    };
}

/** Get-or-create a per-key gate in `gates` and roll it at `chance`. Absent map → pass-through
 *  (true). Backs the engine's per-(owner,ability) proc closures (D-PR4 outgoing amplification).
 *  The per-key map is retained for call-site compatibility; gates are now stateless random draws. */
export function rollRateGate(
    gates: Map<string, ReturnType<typeof makeRateGate>> | undefined,
    key: string,
    chance: number
): boolean {
    if (!gates) return true;
    let gate = gates.get(key);
    if (!gate) {
        // `key` is already the caller's per-(owner,ability) map key (e.g. `${rid}:${abilityId}`,
        // `${ownerId}:${abilityId}`) — reuse it verbatim as the stream key (SP-0 Task 3) so each
        // owner draws from its own sub-stream under the keyed test provider.
        gate = makeRateGate(key);
        gates.set(key, gate);
    }
    return gate(chance);
}
