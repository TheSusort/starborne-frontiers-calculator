/**
 * Deterministic stand-in for a probabilistic event: a fractional accumulator that
 * fires at exactly the supplied rate (a 70% rate over 10 calls fires 7 times).
 * Steady-state spacing is ~1/rate calls, but the schedule is back-loaded: the
 * accumulator starts at 0, so the FIRST fire lands only once the rate has fully
 * accumulated (rate 0.2 first fires on call 5, not call 1).
 *
 * The rate is supplied per call so callers whose probability changes between events
 * (e.g. crit rate shifting with buffs round-to-round) accumulate correctly. Rates are
 * clamped to [0, 1]. EPS absorbs float drift so e.g. ten 0.1 steps fire exactly once.
 *
 * Used by the DPS simulator for crit scheduling, debuff landing, and chance-based
 * DoT extension — replacing Math.random() so identical inputs give identical output.
 */
const EPS = 1e-9;

export function makeRateGate(): (rate: number) => boolean {
    let acc = 0;
    return (rate: number): boolean => {
        acc += Math.min(1, Math.max(0, rate));
        if (acc >= 1 - EPS) {
            acc -= 1;
            return true;
        }
        return false;
    };
}
