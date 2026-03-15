import { describe, it, expect } from 'vitest';
import { applyAdditiveBonuses, calculateMultiplierFactor } from '../scoring';
import { BaseStats } from '../../../types/stats';
import { StatBonus } from '../../../types/autogear';

const baseStats: BaseStats = {
    hp: 50000,
    attack: 10000,
    defence: 8000,
    speed: 300,
    hacking: 5000,
    security: 3000,
    crit: 50,
    critDamage: 150,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

describe('applyAdditiveBonuses', () => {
    it('returns 0 for no bonuses', () => {
        expect(applyAdditiveBonuses(baseStats)).toBe(0);
        expect(applyAdditiveBonuses(baseStats, [])).toBe(0);
    });

    it('calculates additive bonus when mode is undefined', () => {
        const bonuses: StatBonus[] = [{ stat: 'attack', percentage: 10 }];
        // 10% of 10000 = 1000
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(1000);
    });

    it('calculates additive bonus when mode is explicitly additive', () => {
        const bonuses: StatBonus[] = [{ stat: 'hp', percentage: 20, mode: 'additive' }];
        // 20% of 50000 = 10000
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(10000);
    });

    it('ignores multiplier bonuses', () => {
        const bonuses: StatBonus[] = [{ stat: 'attack', percentage: 50, mode: 'multiplier' }];
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(0);
    });

    it('sums multiple additive bonuses', () => {
        const bonuses: StatBonus[] = [
            { stat: 'attack', percentage: 10 }, // 10% of 10000 = 1000
            { stat: 'hp', percentage: 5, mode: 'additive' }, // 5% of 50000 = 2500
            { stat: 'hacking', percentage: 20, mode: 'multiplier' }, // ignored
        ];
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(3500);
    });
});

describe('calculateMultiplierFactor', () => {
    it('returns 0 for no bonuses (1 + 0 = no-op multiplier)', () => {
        expect(calculateMultiplierFactor(baseStats)).toBe(0);
        expect(calculateMultiplierFactor(baseStats, [])).toBe(0);
    });

    it('returns 0 for only additive bonuses', () => {
        const bonuses: StatBonus[] = [
            { stat: 'attack', percentage: 10 },
            { stat: 'hp', percentage: 20, mode: 'additive' },
        ];
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBe(0);
    });

    it('calculates normalized multiplier factor from a single multiplier bonus', () => {
        const bonuses: StatBonus[] = [{ stat: 'speed', percentage: 100, mode: 'multiplier' }];
        // speed=300, normalizer=130 → (300/130) * (100/100) ≈ 2.3077
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBeCloseTo(300 / 130, 4);
    });

    it('sums multiple normalized multiplier bonuses', () => {
        const bonuses: StatBonus[] = [
            { stat: 'attack', percentage: 50, mode: 'multiplier' }, // (10000/10000) * 0.5 = 0.5
            { stat: 'hacking', percentage: 50, mode: 'multiplier' }, // (5000/200) * 0.5 = 12.5
        ];
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBeCloseTo(0.5 + 12.5, 4);
    });

    it('returns 0 when multiplier stat value is 0', () => {
        const bonuses: StatBonus[] = [{ stat: 'shield', percentage: 50, mode: 'multiplier' }];
        // shield=0, normalizer=1 (fallback) → (0/1) * 0.5 = 0
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBe(0);
    });
});
