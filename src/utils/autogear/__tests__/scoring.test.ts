import { describe, it, expect } from 'vitest';
import {
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculateHardViolation,
    evictOldestIfFull,
} from '../scoring';
import { BaseStats } from '../../../types/stats';
import { StatBonus, StatPriority } from '../../../types/autogear';

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

describe('calculateHardViolation', () => {
    const stats = {
        hp: 400000,
        attack: 10000,
        defence: 8000,
        speed: 180,
        hacking: 0,
        security: 0,
        crit: 50,
        critDamage: 150,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    };

    it('returns 0 when no priorities', () => {
        expect(calculateHardViolation(stats, [])).toBe(0);
    });

    it('returns 0 when no priorities are hard-flagged', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200 },
            { stat: 'hp', maxLimit: 300000 },
        ];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('returns 0 when hard-flagged priority has neither minLimit nor maxLimit', () => {
        const priorities: StatPriority[] = [{ stat: 'speed', hardRequirement: true }];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('returns 0 when all hard reqs are met', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 150, hardRequirement: true },
            { stat: 'hp', maxLimit: 500000, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('computes normalized min violation', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1, 10);
    });

    it('computes normalized max violation', () => {
        const priorities: StatPriority[] = [
            { stat: 'hp', maxLimit: 300000, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(1 / 3, 10);
    });

    it('sums violations across multiple hard priorities', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, hardRequirement: true },
            { stat: 'hp', maxLimit: 300000, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1 + 1 / 3, 10);
    });

    it('handles both min and max on a single hard priority', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, maxLimit: 170, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1 + 10 / 170, 10);
    });

    it('ignores soft limits even when hard limits miss', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, hardRequirement: true },
            { stat: 'hp', maxLimit: 100000 },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1, 10);
    });

    it('treats missing stat as 0', () => {
        const priorities: StatPriority[] = [
            { stat: 'hacking', minLimit: 100, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(1.0, 10);
    });
});

describe('evictOldestIfFull', () => {
    it('does nothing when size < limit', () => {
        const m = new Map<string, number>([['a', 1]]);
        evictOldestIfFull(m, 2);
        expect(m.size).toBe(1);
    });

    it('evicts the oldest entry when size === limit', () => {
        const m = new Map<string, number>([
            ['a', 1],
            ['b', 2],
            ['c', 3],
        ]);
        evictOldestIfFull(m, 3);
        expect(m.has('a')).toBe(false);
        expect(m.has('b')).toBe(true);
        expect(m.has('c')).toBe(true);
    });

    it('calls onEvict with the evicted key', () => {
        const m = new Map([
            ['a', 1],
            ['b', 2],
        ]);
        const evicted: string[] = [];
        evictOldestIfFull(m, 2, (k) => evicted.push(k));
        expect(evicted).toEqual(['a']);
    });
});
