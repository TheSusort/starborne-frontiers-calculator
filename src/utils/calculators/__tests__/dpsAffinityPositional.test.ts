/**
 * The affinity matchup on a positional run. The page resolves affinity ONCE into
 * `affinityDamageModifier` / `affinityCritCap` / `affinityCritPenalty` and passes only those — a
 * contract that held while the focus fired at the dummy sink. The positional apply recomputes the
 * matchup per victim from the RAW affinity fields, so the pre-resolved modifier is inert there and
 * the page's affinity dropdown stopped affecting damage when SP-1 gave it a real enemy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { realEnemyInput } from '../__testutils__/dpsRealEnemyFixture';

describe('affinity on a positional DPS run', () => {
    beforeEach(() => {
        setupKeyedTestRng(999);
    });

    it('applies the advantage when raw affinities are threaded', () => {
        const neutral = simulateDPS(realEnemyInput()).summary.totalDamage;

        setupKeyedTestRng(999);
        const advantaged = simulateDPS(
            realEnemyInput({
                affinity: 'chemical',
                enemyAffinity: 'electric',
                affinityDamageModifier: 25,
            })
        );
        // Threading the raw pair must be enough on its own — assert the RATIO, not a magic number.
        // Asserting on the raw totals (toBeCloseTo(neutral * 1.25, 0)) is a trap: 23258 * 1.25 lands
        // on an exact half-integer (29072.5), and the engine's own rounding puts the actual total
        // exactly on the boundary vitest's toBeCloseTo(...,0) requires strict "<" on — measured,
        // reproducible, not RNG noise. Working in ratio space sidesteps that boundary entirely while
        // staying just as tight: an inert modifier would produce a ratio near 1.0, not 1.25.
        expect(advantaged.summary.totalDamage / neutral).toBeCloseTo(1.25, 2);
    });

    it('does not double-apply when the pre-resolved modifier is ALSO supplied', () => {
        setupKeyedTestRng(999);
        const both = simulateDPS(
            realEnemyInput({
                affinity: 'chemical',
                enemyAffinity: 'electric',
                affinityDamageModifier: 25,
            })
        ).summary.totalDamage;

        setupKeyedTestRng(999);
        const rawOnly = simulateDPS(
            realEnemyInput({ affinity: 'chemical', enemyAffinity: 'electric' })
        ).summary.totalDamage;

        expect(both).toBe(rawOnly);
    });
});
