import { describe, it, expect } from 'vitest';
import {
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculatePriorityScore,
    calculateDirectDamage,
    calculateEffectiveHP,
} from '../priorityScore';
import type { BaseStats } from '../../../types/stats';
import type { StatBonus } from '../../../types/autogear';

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

const score = (s: BaseStats, bonuses: StatBonus[] = []) =>
    calculatePriorityScore(s, [], 'DEBUFFER_BOMBER', undefined, undefined, bonuses);

describe('derived stats as stat bonuses', () => {
    it('additive mode resolves effectiveHp instead of reading undefined', () => {
        const s = stats();
        const bonus: StatBonus = { stat: 'effectiveHp', percentage: 50, mode: 'additive' };
        const expected = calculateEffectiveHP(s.hp, s.defence, 0) * 0.5;
        expect(applyAdditiveBonuses(s, [bonus])).toBeCloseTo(expected, 6);
        expect(applyAdditiveBonuses(s, [bonus])).toBeGreaterThan(0);
    });

    it('additive mode resolves directDamage', () => {
        const s = stats();
        const bonus: StatBonus = { stat: 'directDamage', percentage: 50, mode: 'additive' };
        expect(applyAdditiveBonuses(s, [bonus])).toBeCloseTo(calculateDirectDamage(s) * 0.5, 6);
    });

    it('multiplier mode resolves derived stats', () => {
        const s = stats();
        expect(
            calculateMultiplierFactor(s, [
                { stat: 'directDamage', percentage: 100, mode: 'multiplier' },
            ])
        ).toBeCloseTo(calculateDirectDamage(s) / 6000, 6);
        expect(
            calculateMultiplierFactor(s, [
                { stat: 'effectiveHp', percentage: 100, mode: 'multiplier' },
            ])
        ).toBeCloseTo(calculateEffectiveHP(s.hp, s.defence, 0) / 120000, 6);
    });

    // THE NON-VACUITY WITNESS for this whole feature. The bomber role formula is
    // hacking x attack and reads no crit at all (#481, closed no-change). Without a
    // directDamage bonus, crit cannot move a bomber's score; with one, it can. If the
    // first assertion ever fails, the role formula changed and this feature's premise
    // is gone — read #481 before "fixing" this test.
    it('lets crit move a DEBUFFER_BOMBER score, which it cannot do unaided', () => {
        const lowCrit = stats({ crit: 10, critDamage: 20 });
        const highCrit = stats({ crit: 100, critDamage: 200 });

        expect(score(highCrit)).toBe(score(lowCrit));

        const bonus: StatBonus[] = [{ stat: 'directDamage', percentage: 100, mode: 'multiplier' }];
        expect(score(highCrit, bonus)).toBeGreaterThan(score(lowCrit, bonus));
    });

    it('leaves a real-stat bonus byte-identical', () => {
        const s = stats();
        expect(
            applyAdditiveBonuses(s, [{ stat: 'attack', percentage: 20, mode: 'additive' }])
        ).toBe(8000 * 0.2);
    });
});
