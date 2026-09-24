import { describe, it, expect } from 'vitest';
import {
    calculateCritMultiplier,
    resolveLimitStatValue,
    MULTIPLIER_NORMALIZERS,
} from '../statResolution';
import { calculatePriorityScore } from '../priorityScore';
import { customFormulaScore, isBasisStat, usableBasisTerms, FORMULA_STATS } from '../customFormula';
import { STAT_NORMALIZERS, DERIVED_STAT_LABELS, getLimitStatLabel } from '../../../constants/stats';
import type { BaseStats } from '../../../types/stats';
import type { CustomFormula } from '../../../types/autogear';

const stats = (over: Partial<BaseStats> = {}): BaseStats => ({
    hp: 100000,
    attack: 8000,
    defence: 5000,
    hacking: 200,
    security: 150,
    crit: 50,
    critDamage: 150,
    speed: 100,
    hpRegen: 0,
    shield: 0,
    healModifier: 0,
    damageReduction: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    ...over,
});

// calculateCritMultiplier already backs calculateDPS, so these three pin its formula
// directly; the derived-stat tests below (resolveLimitStatValue, customFormulaScore,
// calculatePriorityScore) are what exercise the stat actually being wired up.
describe('calculateCritMultiplier', () => {
    // The cap: crit stops contributing above 100, exactly the same clamp calculateDirectDamage
    // relies on.
    it('gives identical values for crit 100 and crit 150', () => {
        expect(calculateCritMultiplier(stats({ crit: 100, critDamage: 150 }))).toBe(
            calculateCritMultiplier(stats({ crit: 150, critDamage: 150 }))
        );
    });

    it('is exactly 1 at crit 0, regardless of crit power', () => {
        expect(calculateCritMultiplier(stats({ crit: 0, critDamage: 300 }))).toBe(1);
    });

    it('is 2.05 at crit 70 / crit power 150', () => {
        expect(calculateCritMultiplier(stats({ crit: 70, critDamage: 150 }))).toBeCloseTo(2.05, 10);
    });
});

describe('critMultiplier as a derived limit stat', () => {
    it('resolves through resolveLimitStatValue to calculateCritMultiplier', () => {
        const s = stats();
        expect(resolveLimitStatValue(s, 'critMultiplier')).toBe(calculateCritMultiplier(s));
    });

    it('caps at crit 100: crit 100 and crit 150 resolve to the identical, correct value', () => {
        const at100 = resolveLimitStatValue(
            stats({ crit: 100, critDamage: 150 }),
            'critMultiplier'
        );
        const at150 = resolveLimitStatValue(
            stats({ crit: 150, critDamage: 150 }),
            'critMultiplier'
        );
        expect(at100).toBe(2.5);
        expect(at150).toBe(at100);
    });

    it('resolves to exactly 1 at crit 0', () => {
        expect(resolveLimitStatValue(stats({ crit: 0, critDamage: 300 }), 'critMultiplier')).toBe(
            1
        );
    });

    it('resolves to 2.05 at crit 70 / crit power 150', () => {
        expect(
            resolveLimitStatValue(stats({ crit: 70, critDamage: 150 }), 'critMultiplier')
        ).toBeCloseTo(2.05, 10);
    });

    it('has a normalizer near the geared value (~2.0, 100 crit / 100 critDamage)', () => {
        expect(MULTIPLIER_NORMALIZERS.critMultiplier).toBe(2);
        expect(STAT_NORMALIZERS.critMultiplier).toBe(2);
    });

    it('has the Crit Multiplier / CRITx label', () => {
        expect(DERIVED_STAT_LABELS.critMultiplier).toEqual({
            label: 'Crit Multiplier',
            shortLabel: 'CRITx',
        });
        expect(getLimitStatLabel('critMultiplier')).toBe('Crit Multiplier');
    });

    it('is offered by the custom-formula stat picker', () => {
        expect(FORMULA_STATS).toContain('critMultiplier');
    });
});

describe('critMultiplier must not become a basis term', () => {
    // Both checks below also pass on an UNIMPLEMENTED critMultiplier (any unrecognised stat
    // is excluded by the same route), so neither is a red/green witness for this feature —
    // what they guard against is a FUTURE change that adds critMultiplier to
    // MULTIPLIER_NORMALIZERS without also adding it to DERIVED_STATS.
    it('isBasisStat rejects it', () => {
        expect(isBasisStat('critMultiplier')).toBe(false);
    });

    it("is silently dropped when named inside another row's basis", () => {
        expect(
            usableBasisTerms([
                { stat: 'critMultiplier', weight: 1 },
                { stat: 'attack', weight: 1 },
            ])
        ).toEqual([{ stat: 'attack', weight: 1 }]);
    });
});

describe('a custom-formula row on critMultiplier scores', () => {
    it('a core row scores calculateCritMultiplier normalized, like every other core row', () => {
        const s = stats({ crit: 70, critDamage: 150 });
        const formula: CustomFormula = {
            rows: [{ stat: 'critMultiplier', kind: 'core', direction: 'max' }],
        };
        // formulaRowTerm's normal shape for a single max core row: raw / normalizer.
        expect(customFormulaScore(s, formula)).toBeCloseTo(
            calculateCritMultiplier(s) / MULTIPLIER_NORMALIZERS.critMultiplier!,
            10
        );
    });

    it('a bonus row on critMultiplier is not silently skipped', () => {
        const s = stats({ crit: 70, critDamage: 150 });
        const coreOnly: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const withCritMultiplierBonus: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max' },
                { stat: 'critMultiplier', kind: 'bonus', direction: 'max', percentage: 100 },
            ],
        };
        expect(customFormulaScore(s, withCritMultiplierBonus)).toBeGreaterThan(
            customFormulaScore(s, coreOnly)
        );
    });
});

describe('a custom formula on critMultiplier ranks builds through calculatePriorityScore', () => {
    // THE NON-VACUITY WITNESS: goes through the full GA scoring entry point
    // (calculatePriorityScore -> customFormulaScore), not only the helper directly, because
    // that is the path the default GA scoring (fastScore) actually routes through.
    it('ranks crit 100 / crit power 150 above crit 150 / crit power 100', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'critMultiplier', kind: 'core', direction: 'max' }],
        };
        const better = stats({ crit: 100, critDamage: 150 });
        const worse = stats({ crit: 150, critDamage: 100 });

        const betterScore = calculatePriorityScore(
            better,
            [],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            formula
        );
        const worseScore = calculatePriorityScore(
            worse,
            [],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            0,
            undefined,
            formula
        );

        expect(betterScore).toBeGreaterThan(worseScore);
    });
});
