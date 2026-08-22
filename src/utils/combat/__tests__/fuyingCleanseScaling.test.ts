import { describe, it, expect } from 'vitest';
import { parseCleanse } from '../../skillTextParser';
import { scaledStatusCount } from '../statusCountScaling';

// ---------------------------------------------------------------------------
// #363 (Fuying, Gap 3): her charged skill's cleanse scales on crit power —
// "cleanses 1 debuff for every 50% crit power this Unit has" — identically to
// Amartya's purge ("purges 1 buff … for every 50% crit power", E4). The
// countScaling field already existed on the shared cleanse|purge config for
// Amartya; this closes the gap for cleanse by lifting the arithmetic into a
// shared helper, scaledStatusCount (./statusCountScaling), used by BOTH the
// purge branch (playerTurn.ts, unchanged behaviour — see amartyaCritPurge.test.ts)
// and the cleanse branch.
// ---------------------------------------------------------------------------

describe('Fuying crit-power-scaled cleanse (#363)', () => {
    it('parses countScaling off the cleanse clause', () => {
        const charged =
            'This Unit <unit-aid>cleanses 1 debuff</unit-aid> for every 50% crit power this ' +
            'Unit has and extends <unit-skill>Stealth</unit-skill> by 1 turn.';
        expect(parseCleanse(charged)[0]).toMatchObject({
            count: 1,
            countScaling: { stat: 'critDamage', per: 50 },
        });
    });

    it('an untyped, unscaled cleanse still omits countScaling', () => {
        const plain = 'This Unit cleanses 1 debuff from itself.';
        expect(parseCleanse(plain)[0]).not.toHaveProperty('countScaling');
    });

    it('scales the count on live crit power, and leaves an unscaled cleanse alone', () => {
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 50 }, 150)).toBe(3);
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 50 }, 149)).toBe(2); // floor
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 50 }, 0)).toBe(0);
        expect(scaledStatusCount(2, undefined, 150)).toBe(2);
        // 'all' is never scaled — the existing purge guard's typeof check must survive the lift.
        expect(scaledStatusCount('all', { stat: 'critDamage', per: 50 }, 150)).toBe('all');
        // Defensive: a hand-built config must not yield Infinity/NaN.
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 0 }, 150)).toBe(1);
    });
});
