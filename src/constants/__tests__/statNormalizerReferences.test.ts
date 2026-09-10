import { describe, it, expect } from 'vitest';
import { STAT_NORMALIZERS } from '../stats';
import { getScoringBaselineStats, ROLE_BASE_STATS } from '../roleBaseStats';
import { calculateDirectDamage, calculateEffectiveHP } from '../../utils/autogear/priorityScore';

// STAT_NORMALIZERS drives implant pre-filtering (implantFilter.ts, which normalizes both
// the priority and the bonus term when ranking implant candidates). It is NOT read by the
// optimizer's stat-bonus fitness term (calculateMultiplierFactor /
// applyAdditiveBonuses in priorityScore.ts) — that reads MULTIPLIER_NORMALIZERS instead
// (see derivedStatBonuses.test.ts). A wrong normalizer here silently mis-ranks
// implant candidates against each other. These bounds are
// wide (they are not asserting an exact formula) but they fail if a reference moves by
// more than ~2x, which is the point at which a chosen normalizer stops meaning what it was
// chosen to mean.
describe('derived-stat normalizer references', () => {
    it('directDamage at the ATTACKER scoring baseline stays near its limit normalizer', () => {
        const baseline = getScoringBaselineStats('ATTACKER');
        const value = calculateDirectDamage(baseline);
        // Measured 3,215 on 2026-09-07 against STAT_NORMALIZERS.directDamage = 3000.
        expect(value).toBeGreaterThan(1500);
        expect(value).toBeLessThan(6000);
        expect(STAT_NORMALIZERS.directDamage).toBe(3000);
    });

    it('effectiveHp at the ATTACKER bare chassis stays near its limit normalizer', () => {
        const base = ROLE_BASE_STATS.ATTACKER;
        const value = calculateEffectiveHP(base.hp, base.defence, 0);
        // Measured 52,814 on 2026-09-07 against STAT_NORMALIZERS.effectiveHp = 30000.
        expect(value).toBeGreaterThan(25000);
        expect(value).toBeLessThan(110000);
        expect(STAT_NORMALIZERS.effectiveHp).toBe(30000);
    });
});
