import { describe, it, expect } from 'vitest';
import type { BaseStats } from '../../../types/stats';
import type { CustomFormulaRow } from '../../../types/autogear';
import { calculateDirectDamage, calculateEffectiveHP } from '../statResolution';
import { formulaRowTerm, usableBasis } from '../customFormula';

const stats: BaseStats = {
    attack: 10000,
    hp: 50000,
    defence: 7000,
    hacking: 200,
    security: 75,
    crit: 60,
    critDamage: 130,
    speed: 130,
};

describe('an absent basis is the old behaviour', () => {
    it('resolves directDamage identically', () => {
        expect(calculateDirectDamage(stats, undefined)).toBe(calculateDirectDamage(stats));
    });

    it('resolves effectiveHp identically', () => {
        expect(calculateEffectiveHP(stats.hp, stats.defence, 0, undefined)).toBe(
            calculateEffectiveHP(stats.hp, stats.defence, 0)
        );
    });

    it('an explicit attack-only basis equals the default', () => {
        expect(calculateDirectDamage(stats, [{ stat: 'attack', weight: 1 }])).toBeCloseTo(
            calculateDirectDamage(stats),
            6
        );
    });
});

describe('a blended basis', () => {
    it('adds the second term into the primary factor, before crit and mitigation', () => {
        // Cobalt: attack x2.100 + hp x0.267 -> primary factor 10000*2.1 + 50000*0.267 = 34350
        const blended = calculateDirectDamage(stats, [
            { stat: 'attack', weight: 2.1 },
            { stat: 'hp', weight: 0.267 },
        ]);
        const attackOnly = calculateDirectDamage(stats, [{ stat: 'attack', weight: 2.1 }]);
        expect(blended / attackOnly).toBeCloseTo(34350 / 21000, 6);
    });

    it('supports a zero-attack basis (Prophet deals no attack-scaled damage)', () => {
        const prophet = calculateDirectDamage(stats, [{ stat: 'security', weight: 57.778 }]);
        expect(prophet).toBeGreaterThan(0);
        // Changing attack must not move it at all.
        expect(
            calculateDirectDamage({ ...stats, attack: 99999 }, [
                { stat: 'security', weight: 57.778 },
            ])
        ).toBe(prophet);
    });

    it('blends only the HP factor of effectiveHp, leaving mitigation on real defence', () => {
        const tilted = calculateEffectiveHP(
            stats.hp,
            stats.defence,
            0,
            [
                { stat: 'hp', weight: 1 },
                { stat: 'defence', weight: 2 },
            ],
            stats
        );
        const plain = calculateEffectiveHP(stats.hp, stats.defence, 0);
        expect(tilted / plain).toBeCloseTo((50000 + 14000) / 50000, 6);
    });

    it('honours a basis on a PLAIN-stat core row, not only a derived one', () => {
        // SUPPORTER's core is `core('hp')`. Howler's fix is a basis on that row, and Makoli's is
        // [hp x1, defence x18.8] on it. Routing only directDamage/effectiveHp makes Apply a
        // silent no-op for both.
        const makoli: CustomFormulaRow = {
            stat: 'hp',
            kind: 'core',
            direction: 'max',
            basis: [
                { stat: 'hp', weight: 1 },
                { stat: 'defence', weight: 18.8 },
            ],
        };
        const plainHp: CustomFormulaRow = { stat: 'hp', kind: 'core', direction: 'max' };
        // 50000 + 7000*18.8 = 181600, against 50000.
        expect(formulaRowTerm(stats, makoli) / formulaRowTerm(stats, plainHp)).toBeCloseTo(
            181600 / 50000,
            6
        );
    });

    it('a plain core row with NO basis is unchanged', () => {
        expect(formulaRowTerm(stats, { stat: 'speed', kind: 'core', direction: 'max' })).toBe(
            stats.speed / 130
        );
    });
});

describe('usableBasis rejects what the scorer cannot honour', () => {
    const core = (basis: unknown): CustomFormulaRow =>
        ({ stat: 'directDamage', kind: 'core', direction: 'max', basis }) as CustomFormulaRow;

    it('drops an entry naming a stat with no normalizer', () => {
        expect(
            usableBasis(
                core([
                    { stat: 'attack', weight: 1 },
                    { stat: 'nonsense', weight: 1 },
                ])
            )
        ).toEqual([{ stat: 'attack', weight: 1 }]);
    });

    it('drops a DERIVED stat used as a basis term', () => {
        // directDamage and effectiveHp both have MULTIPLIER_NORMALIZERS entries, so a
        // "has a normalizer" check admits them — and resolveBasisValue would then read
        // stats['directDamage'] as undefined and contribute 0, silently deleting the term.
        expect(
            usableBasis(
                core([
                    { stat: 'attack', weight: 1 },
                    { stat: 'directDamage', weight: 1 },
                    { stat: 'effectiveHp', weight: 1 },
                ])
            )
        ).toEqual([{ stat: 'attack', weight: 1 }]);
    });

    it('drops a non-finite or negative weight', () => {
        expect(
            usableBasis(
                core([
                    { stat: 'attack', weight: 1 },
                    { stat: 'hp', weight: Number.NaN },
                    { stat: 'defence', weight: -3 },
                ])
            )
        ).toEqual([{ stat: 'attack', weight: 1 }]);
    });

    it('returns undefined when every entry is dropped, so the default factor applies', () => {
        expect(
            usableBasis(core([{ stat: 'hp', weight: Number.POSITIVE_INFINITY }]))
        ).toBeUndefined();
    });

    it('ignores a basis on a bonus row', () => {
        expect(
            usableBasis({
                stat: 'directDamage',
                kind: 'bonus',
                direction: 'max',
                basis: [{ stat: 'hp', weight: 1 }],
            })
        ).toBeUndefined();
    });

    it('ignores a basis on a minimised row, which is not scale-invariant', () => {
        expect(
            usableBasis({
                stat: 'directDamage',
                kind: 'core',
                direction: 'min',
                basis: [{ stat: 'hp', weight: 1 }],
            })
        ).toBeUndefined();
    });

    it('is reflected in formulaRowTerm, not only in the helper', () => {
        const withBad = formulaRowTerm(stats, core([{ stat: 'hp', weight: Number.NaN }]));
        const plain = formulaRowTerm(stats, {
            stat: 'directDamage',
            kind: 'core',
            direction: 'max',
        });
        expect(withBad).toBe(plain);
    });

    it('rejects an ALL-ZERO basis rather than scoring 0 for every candidate', () => {
        // Every individual term passes `weight >= 0` and survives the filter, but a basis
        // where every surviving weight is 0 resolves to 0 regardless of the candidate's own
        // stats — the row must fall back to its plain stat instead of tying the search.
        expect(usableBasis(core([{ stat: 'attack', weight: 0 }]))).toBeUndefined();
        expect(
            usableBasis(
                core([
                    { stat: 'attack', weight: 0 },
                    { stat: 'hp', weight: 0 },
                ])
            )
        ).toBeUndefined();

        const withAllZero = formulaRowTerm(stats, core([{ stat: 'attack', weight: 0 }]));
        const plain = formulaRowTerm(stats, {
            stat: 'directDamage',
            kind: 'core',
            direction: 'max',
        });
        expect(withAllZero).toBe(plain);
        expect(withAllZero).not.toBe(0);
    });

    it('keeps a zero-weight term that sits alongside a positive one', () => {
        // A zero term contributes nothing on its own (like an absent term), so it is harmless
        // once at least one other term actually moves the value — only an ALL-zero basis must
        // be rejected.
        expect(
            usableBasis(
                core([
                    { stat: 'attack', weight: 0 },
                    { stat: 'hp', weight: 2 },
                ])
            )
        ).toEqual([
            { stat: 'attack', weight: 0 },
            { stat: 'hp', weight: 2 },
        ]);
    });
});
