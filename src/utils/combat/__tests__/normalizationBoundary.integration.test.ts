/**
 * SP-4b-1: the boundary is live — a caller that supplies NO positions and NO targeting still gets
 * a fully positional run. Pre-boundary, this fixture routed the focus's cast into the dummy sink:
 * `perTargetDealt` came back empty while `rawTotals.cumulative` looked plausible.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput } from '../__testutils__/bareRosterFixture';

describe('the normalization boundary is live in runCombat', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('routes a position-less, targeting-less roster per-victim instead of into the sink', () => {
        const { rounds } = runCombat(bareInput());

        // perTargetDealt is the discriminator. Pre-boundary it was EMPTY for this input. The
        // `every(... === 'e1')` below is also the "never routes to the dummy" assertion — a
        // separate test asserting `victims` (not `dealt`) `.not.toContain('enemy')` passed
        // vacuously whenever `dealt` was empty and added no signal `every` didn't already cover
        // once `dealt.length > 0` is established, so it was folded in here rather than kept
        // standalone.
        const dealt = rounds.flatMap((r) =>
            Object.entries(r.perTargetDealt ?? {}).flatMap(([source, byVictim]) =>
                Object.entries(byVictim).map(([victim, amount]) => ({
                    source,
                    victim,
                    amount,
                }))
            )
        );
        expect(dealt.length).toBeGreaterThan(0);
        expect(dealt.every((d) => d.victim === 'e1')).toBe(true);
        expect(dealt.some((d) => d.amount > 0)).toBe(true);
    });

    // "leaves an explicitly-positioned run byte-identical" used to live here, comparing
    // `runCombat` against ITSELF under the same RNG seed — that proves RNG determinism, not that
    // the boundary is a no-op on positioned input. The honest form of that claim is a
    // module-level assertion on `normalizeCombatRoster` directly: see
    // `normalizeRoster.test.ts`'s "is a no-op on a fully-positioned, fully-targeted input".
});
