import { describe, it, expect } from 'vitest';
import { MULTIPLIER_NORMALIZERS } from '../statResolution';
import { FORMULA_STATS, customFormulaScore } from '../customFormula';
import type { BaseStats } from '../../../types/stats';
import type { CustomFormula } from '../../../types/autogear';

describe('every stat the formula picker offers can be put on a comparable scale', () => {
    // A stat with no normalizer falls back to 1, so its term reads as the raw stat value —
    // orders of magnitude above every other row, which lets one row decide the ranking.
    // Keyed to the list the picker renders from, so adding a stat fails here, not in a build.
    it.each([...FORMULA_STATS])('%s has a normalizer', (stat) => {
        expect(MULTIPLIER_NORMALIZERS[stat]).toBeGreaterThan(0);
    });

    it('covers a list that is actually populated', () => {
        // Non-vacuity: an empty list would satisfy every case above.
        expect(FORMULA_STATS.length).toBeGreaterThan(5);
    });
});

describe('a stat outside the picker cannot dominate a formula', () => {
    const stats: BaseStats = {
        hp: 50000,
        attack: 8000,
        defence: 7000,
        speed: 130,
        hacking: 200,
        security: 75,
        crit: 50,
        critDamage: 130,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 40,
    };

    it('skips a row on a stat it cannot scale, rather than reading its raw value', () => {
        // defensePenetration has no normalizer and the picker does not offer it, but a
        // stored formula can still name it. At 40 it would swamp a term of ~0.8.
        const withUnscalable: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max' },
                { stat: 'defensePenetration', kind: 'bonus', direction: 'max', percentage: 100 },
            ],
        };
        const attackOnly: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        expect(customFormulaScore(stats, withUnscalable)).toBeCloseTo(
            customFormulaScore(stats, attackOnly),
            10
        );
    });

    it('leaves a formula of only unscalable rows at the empty product', () => {
        const allUnscalable: CustomFormula = {
            rows: [{ stat: 'defensePenetration', kind: 'core', direction: 'max' }],
        };
        const score = customFormulaScore(stats, allUnscalable);
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBe(1);
    });
});
