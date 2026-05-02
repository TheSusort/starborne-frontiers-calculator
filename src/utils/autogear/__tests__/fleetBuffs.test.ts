import { describe, it, expect } from 'vitest';
import { applyFleetBuffs } from '../fleetBuffs';
import type { BaseStats } from '../../../types/stats';

const BASE: BaseStats = {
    hp: 10000,
    attack: 5000,
    defence: 3000,
    speed: 100,
    hacking: 50,
    security: 50,
    crit: 70,
    critDamage: 150,
    healModifier: 10,
    shield: 0,
    hpRegen: 0,
    defensePenetration: 10,
    shieldPenetration: 0,
    damageReduction: 0,
};

describe('applyFleetBuffs', () => {
    it('returns stats unchanged when buffs array is empty', () => {
        const result = applyFleetBuffs(BASE, []);
        expect(result).toEqual(BASE);
    });

    it('does not mutate the original stats object', () => {
        const snapshot = { ...BASE };
        applyFleetBuffs(BASE, [{ stat: 'crit', percentage: 30 }]);
        expect(BASE).toEqual(snapshot);
    });

    it('adds buff directly to percentage-only stats (additive)', () => {
        const result = applyFleetBuffs(BASE, [{ stat: 'crit', percentage: 30 }]);
        expect(result.crit).toBe(100);
    });

    it('leaves unrelated stats unchanged when buffing a percentage stat', () => {
        const result = applyFleetBuffs(BASE, [{ stat: 'crit', percentage: 30 }]);
        expect(result.attack).toBe(5000);
        expect(result.hp).toBe(10000);
    });

    it('multiplies flat stats by (1 + pct/100)', () => {
        const result = applyFleetBuffs(BASE, [{ stat: 'attack', percentage: 45 }]);
        expect(result.attack).toBeCloseTo(7250);
    });

    it('leaves unrelated stats unchanged when buffing a flat stat', () => {
        const result = applyFleetBuffs(BASE, [{ stat: 'attack', percentage: 45 }]);
        expect(result.crit).toBe(70);
        expect(result.hp).toBe(10000);
    });

    it('applies multiple buffs in sequence', () => {
        const result = applyFleetBuffs(BASE, [
            { stat: 'crit', percentage: 30 },
            { stat: 'attack', percentage: 10 },
            { stat: 'critDamage', percentage: 20 },
        ]);
        expect(result.crit).toBe(100);
        expect(result.attack).toBeCloseTo(5500);
        expect(result.critDamage).toBe(170);
    });

    it('skips silently when stat key is absent from BaseStats', () => {
        expect(() =>
            applyFleetBuffs(BASE, [{ stat: 'nonexistent' as never, percentage: 50 }])
        ).not.toThrow();
        const result = applyFleetBuffs(BASE, [{ stat: 'nonexistent' as never, percentage: 50 }]);
        expect(result).toEqual(BASE);
    });

    it('handles optional percentage-only stat', () => {
        const result = applyFleetBuffs(BASE, [{ stat: 'defensePenetration', percentage: 10 }]);
        expect(result.defensePenetration).toBe(20);
    });

    it('compounds multiple buffs on the same flat stat sequentially', () => {
        const result = applyFleetBuffs(BASE, [
            { stat: 'attack', percentage: 10 },
            { stat: 'attack', percentage: 10 },
        ]);
        expect(result.attack).toBeCloseTo(BASE.attack * 1.1 * 1.1);
    });
});
