/**
 * #407: the `isLiving` predicate parameter is GONE from `highestAttackAmong`. Liveness moved UP the
 * chain to `aliveTargetsOf` (targetableActors.ts), the one gate for the whole selector layer, so
 * every caller now hands this function a roster that is already narrowed to living actors. The
 * "skips dead actors" case below is therefore expressed as what a pre-gated caller passes: the dead
 * id simply is not in `ids`.
 *
 * Do not re-add a liveness argument here. Asking the same question at four separate sites is how
 * `mostBuffsAmong` became the one site that forgot to ask it.
 */
import { describe, it, expect } from 'vitest';
import { highestAttackAmong } from '../highestAttack';

describe('highestAttackAmong', () => {
    const attackOf = (id: string) => ({ a: 100, b: 250, c: 250, d: 50 })[id] ?? 0;

    it('returns the id with the greatest attack', () => {
        expect(highestAttackAmong(['a', 'b', 'd'], attackOf)).toBe('b');
    });

    it('breaks ties by roster order (first wins)', () => {
        expect(highestAttackAmong(['a', 'b', 'c'], attackOf)).toBe('b');
    });

    it('never sees a dead actor — the caller pre-gates the roster', () => {
        // Pre-#407 this passed `living(['b'])` as a third argument. Now 'b' is absent from `ids`
        // because `aliveTargetsOf` removed it before the call, and the answer is the same.
        expect(highestAttackAmong(['c'], attackOf)).toBe('c');
    });

    it('returns undefined for an empty candidate list', () => {
        // The pre-gated equivalent of the old "no living candidate" case: when everyone is dead,
        // `aliveTargetsOf` hands this function an empty roster.
        expect(highestAttackAmong([], attackOf)).toBeUndefined();
    });
});
