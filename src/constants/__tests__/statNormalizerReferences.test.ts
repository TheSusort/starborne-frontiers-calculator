import { describe, it, expect } from 'vitest';
import { STAT_NORMALIZERS } from '../stats';
import { getScoringBaselineStats, ROLE_BASE_STATS } from '../roleBaseStats';
import { calculateDirectDamage, calculateEffectiveHP } from '../../utils/autogear/priorityScore';

// A normalizer decides how heavily a stat bonus weighs, and stat bonuses ride along in
// SHARED community builds — so a silent change to the crit targets or the defense curve
// would re-weigh every shared build that uses one. These bounds are wide (they are not
// asserting an exact formula) but they fail if a reference moves by more than ~2x, which
// is the point at which a chosen normalizer stops meaning what it was chosen to mean.
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
