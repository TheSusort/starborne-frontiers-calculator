import { describe, it, expect } from 'vitest';
import { calculateDirectDamage, resolveLimitStatValue } from '../priorityScore';
import { STAT_NORMALIZERS, DERIVED_STAT_LABELS, getLimitStatLabel } from '../../../constants/stats';
import type { BaseStats } from '../../../types/stats';

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

describe('directDamage derived stat', () => {
    it('resolves through resolveLimitStatValue to calculateDirectDamage', () => {
        const s = stats();
        expect(resolveLimitStatValue(s, 'directDamage')).toBe(calculateDirectDamage(s));
    });

    it('is positive for a normal build', () => {
        expect(calculateDirectDamage(stats())).toBeGreaterThan(0);
    });

    // The four ingredients the stat exists to combine.
    it('increases with attack', () => {
        expect(calculateDirectDamage(stats({ attack: 16000 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ attack: 8000 }))
        );
    });

    it('increases with crit rate below the cap', () => {
        expect(calculateDirectDamage(stats({ crit: 90 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ crit: 50 }))
        );
    });

    it('increases with crit power', () => {
        expect(calculateDirectDamage(stats({ critDamage: 200 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ critDamage: 150 }))
        );
    });

    it('increases with defense penetration', () => {
        expect(calculateDirectDamage(stats({ defensePenetration: 41 }))).toBeGreaterThan(
            calculateDirectDamage(stats({ defensePenetration: 0 }))
        );
    });

    // This clamp is the whole reason the stat exists: a raw `crit` bonus keeps paying
    // past 100, where calculateCritMultiplier stops crediting it.
    it('does NOT increase for crit above 100', () => {
        expect(calculateDirectDamage(stats({ crit: 150 }))).toBe(
            calculateDirectDamage(stats({ crit: 100 }))
        );
    });

    it('has a normalizer and a label', () => {
        expect(STAT_NORMALIZERS.directDamage).toBe(3000);
        expect(DERIVED_STAT_LABELS.directDamage.label).toBe('Direct Damage');
        expect(getLimitStatLabel('directDamage')).toBe('Direct Damage');
    });
});
