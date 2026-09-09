import { describe, it, expect } from 'vitest';
import { customFormulaScore, formulaRowTerm, isFormulaEmpty } from '../customFormula';
import type { CustomFormula } from '../../../types/autogear';
import type { BaseStats } from '../../../types/stats';

const base: BaseStats = {
    hp: 50000,
    attack: 10000,
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
    defensePenetration: 0,
};

const withStats = (over: Partial<BaseStats>): BaseStats => ({ ...base, ...over });

describe('customFormulaScore — empty and absent formulas', () => {
    it('scores 0 for an absent formula', () => {
        expect(customFormulaScore(base, undefined)).toBe(0);
    });

    it('scores 0 for a formula with no rows', () => {
        expect(customFormulaScore(base, { rows: [] })).toBe(0);
    });

    it('reports emptiness for both', () => {
        expect(isFormulaEmpty(undefined)).toBe(true);
        expect(isFormulaEmpty({ rows: [] })).toBe(true);
        expect(isFormulaEmpty({ rows: [{ stat: 'hp', kind: 'core', direction: 'max' }] })).toBe(
            false
        );
    });
});

describe('formulaRowTerm', () => {
    it('normalizes a maximized term against the stat geared value', () => {
        // MULTIPLIER_NORMALIZERS.attack is 10000.
        const term = formulaRowTerm(withStats({ attack: 20000 }), {
            stat: 'attack',
            kind: 'core',
            direction: 'max',
        });
        expect(term).toBeCloseTo(2, 10);
    });

    it('gives a minimized term exactly 0.5 at the normalizer', () => {
        // 1 / (1 + 10000/10000) = 0.5. The normalizer is the half-point, which is why
        // the minimize direction depends on it and the maximize direction does not.
        const term = formulaRowTerm(withStats({ attack: 10000 }), {
            stat: 'attack',
            kind: 'core',
            direction: 'min',
        });
        expect(term).toBeCloseTo(0.5, 10);
    });

    it('gives a minimized term below 1 and above 0 for every finite value', () => {
        const low = formulaRowTerm(withStats({ speed: 90 }), {
            stat: 'speed',
            kind: 'core',
            direction: 'min',
        });
        const high = formulaRowTerm(withStats({ speed: 300 }), {
            stat: 'speed',
            kind: 'core',
            direction: 'min',
        });
        expect(low).toBeGreaterThan(high);
        expect(high).toBeGreaterThan(0);
        expect(low).toBeLessThanOrEqual(1);
    });
});

describe('customFormulaScore — the product rewards balance', () => {
    const product: CustomFormula = {
        rows: [
            { stat: 'hacking', kind: 'core', direction: 'max' },
            { stat: 'effectiveHp', kind: 'core', direction: 'max' },
        ],
    };

    it('ranks a balanced build above a lopsided one', () => {
        // hacking normalizer 200, effectiveHp normalizer 120000.
        const balanced = customFormulaScore(withStats({ hacking: 200, hp: 50000 }), product);
        const lopsided = customFormulaScore(withStats({ hacking: 400, hp: 12000 }), product);
        expect(balanced).toBeGreaterThan(lopsided);
    });

    it('reverses that ranking when the same two stats are bonus rows instead', () => {
        // Same stats, same builds, only the kind differs — so the flip is caused by core
        // rows multiplying rather than adding, which is why they do (#482). Both arms run
        // through the real scorer; a hand-rolled sum here would assert nothing about it.
        const asSum: CustomFormula = {
            rows: [
                { stat: 'hacking', kind: 'bonus', direction: 'max', percentage: 100 },
                { stat: 'effectiveHp', kind: 'bonus', direction: 'max', percentage: 100 },
            ],
        };
        const balanced = withStats({ hacking: 200, hp: 50000 });
        const lopsided = withStats({ hacking: 400, hp: 12000 });

        expect(customFormulaScore(balanced, product)).toBeGreaterThan(
            customFormulaScore(lopsided, product)
        );
        expect(customFormulaScore(lopsided, asSum)).toBeGreaterThan(
            customFormulaScore(balanced, asSum)
        );
    });
});

describe('customFormulaScore — direction', () => {
    it('ranks a lower value higher for a minimized core row', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'core', direction: 'min' }],
        };
        expect(customFormulaScore(withStats({ speed: 95 }), formula)).toBeGreaterThan(
            customFormulaScore(withStats({ speed: 200 }), formula)
        );
    });

    it('ranks a lower value higher for a minimized bonus row', () => {
        const formula: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max' },
                { stat: 'speed', kind: 'bonus', direction: 'min', percentage: 100 },
            ],
        };
        expect(customFormulaScore(withStats({ speed: 95 }), formula)).toBeGreaterThan(
            customFormulaScore(withStats({ speed: 200 }), formula)
        );
    });
});

describe('customFormulaScore — importance', () => {
    it('weighs a Heavy core row more than a Normal one', () => {
        const heavyAttack: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max', importance: 2 },
                { stat: 'crit', kind: 'core', direction: 'max', importance: 1 },
            ],
        };
        // Trade 25% of attack for a 50% bigger crit. With attack Heavy the trade is bad;
        // the same trade under equal importance is good.
        const attackHeavy = customFormulaScore(withStats({ attack: 10000, crit: 40 }), heavyAttack);
        const critHeavy = customFormulaScore(withStats({ attack: 7500, crit: 60 }), heavyAttack);
        expect(attackHeavy).toBeGreaterThan(critHeavy);

        const equal: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max', importance: 1 },
                { stat: 'crit', kind: 'core', direction: 'max', importance: 1 },
            ],
        };
        expect(customFormulaScore(withStats({ attack: 7500, crit: 60 }), equal)).toBeGreaterThan(
            customFormulaScore(withStats({ attack: 10000, crit: 40 }), equal)
        );
    });

    it('cannot reorder a ranking when there is one core row and no bonus rows', () => {
        // An exponent is a monotone transform. This is why the UI disables the control here.
        const one: BaseStats = withStats({ attack: 8000 });
        const two: BaseStats = withStats({ attack: 12000 });
        for (const importance of [0.5, 1, 2] as const) {
            const formula: CustomFormula = {
                rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance }],
            };
            expect(customFormulaScore(two, formula)).toBeGreaterThan(
                customFormulaScore(one, formula)
            );
        }
    });
});

describe('customFormulaScore — a zero core term zeroes the product', () => {
    it('scores 0 when a maximized core stat is 0, whatever the other rows hold', () => {
        // Deliberate product semantics, and the reason a stat that can be 0 at base
        // belongs in a bonus row. The UI surfaces this case on the row.
        const formula: CustomFormula = {
            rows: [
                { stat: 'hp', kind: 'core', direction: 'max' },
                { stat: 'healModifier', kind: 'core', direction: 'max' },
            ],
        };
        expect(customFormulaScore(withStats({ healModifier: 0 }), formula)).toBe(0);
        expect(customFormulaScore(withStats({ healModifier: 50 }), formula)).toBeGreaterThan(0);
    });

    it('leaves the other rows ranking intact when that stat is a bonus row instead', () => {
        const formula: CustomFormula = {
            rows: [
                { stat: 'hp', kind: 'core', direction: 'max' },
                { stat: 'healModifier', kind: 'bonus', direction: 'max', percentage: 100 },
            ],
        };
        expect(
            customFormulaScore(withStats({ hp: 60000, healModifier: 0 }), formula)
        ).toBeGreaterThan(customFormulaScore(withStats({ hp: 40000, healModifier: 0 }), formula));
    });
});

describe('customFormulaScore — bonus-only and mixed formulas', () => {
    it('scores a bonus-only formula off the empty product', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max', percentage: 100 }],
        };
        // 1 + 1.0 * (130/130) = 2
        expect(customFormulaScore(withStats({ speed: 130 }), formula)).toBeCloseTo(2, 10);
    });

    it('scales a bonus row by its percentage', () => {
        const half: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max', percentage: 50 }],
        };
        expect(customFormulaScore(withStats({ speed: 130 }), half)).toBeCloseTo(1.5, 10);
    });

    it('multiplies the core product by the bonus factor', () => {
        const formula: CustomFormula = {
            rows: [
                { stat: 'attack', kind: 'core', direction: 'max' },
                { stat: 'speed', kind: 'bonus', direction: 'max', percentage: 100 },
            ],
        };
        // (10000/10000) * (1 + 130/130) = 2
        expect(customFormulaScore(withStats({ attack: 10000, speed: 130 }), formula)).toBeCloseTo(
            2,
            10
        );
    });
});

describe('customFormulaScore — defaults on a partial row', () => {
    it('treats a core row with no importance as Normal', () => {
        const bare: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const normal: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
        };
        expect(customFormulaScore(base, bare)).toBeCloseTo(customFormulaScore(base, normal), 10);
    });

    it('treats a bonus row with no percentage as 100', () => {
        const bare: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max' }],
        };
        const full: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'bonus', direction: 'max', percentage: 100 }],
        };
        expect(customFormulaScore(base, bare)).toBeCloseTo(customFormulaScore(base, full), 10);
    });
});
