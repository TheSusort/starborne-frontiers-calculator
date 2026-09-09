import { describe, it, expect } from 'vitest';
import { calculateRoleScore, previewStatBonus } from '../priorityScore';
import { SHIP_TYPES } from '../../../constants';
import type { ShipTypeName } from '../../../constants';
import type { BaseStats } from '../../../types/stats';
import type { StatBonus } from '../../../types/autogear';

const stats: BaseStats = {
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
};

const roles: ShipTypeName[] = Object.keys(SHIP_TYPES);

describe('calculateRoleScore bonus passthrough', () => {
    // The widening must be additive: every existing two-argument caller keeps its number.
    it('is unchanged for every role when no bonuses are passed', () => {
        for (const role of roles) {
            expect(calculateRoleScore(role, stats, [])).toBe(calculateRoleScore(role, stats));
            expect(calculateRoleScore(role, stats, undefined)).toBe(
                calculateRoleScore(role, stats)
            );
        }
    });

    it('applies a bonus for every role that scores at all', () => {
        const bonus: StatBonus[] = [{ stat: 'directDamage', percentage: 100, mode: 'multiplier' }];
        for (const role of roles) {
            const bare = calculateRoleScore(role, stats);
            if (bare <= 0) continue;
            expect(calculateRoleScore(role, stats, bonus)).toBeGreaterThan(bare);
        }
    });
});

describe('previewStatBonus', () => {
    const bonus: StatBonus = { stat: 'directDamage', percentage: 100, mode: 'multiplier' };

    it('reports the resolved value of a derived stat', () => {
        const preview = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus);
        expect(preview.statValue).toBeGreaterThan(0);
    });

    it('newScore exceeds baseScore for a bonus that does something', () => {
        const preview = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus);
        expect(preview.applies).toBe(true);
        expect(preview.newScore).toBeGreaterThan(preview.baseScore);
    });

    it('reports the MARGINAL effect — baseScore already includes the other bonuses', () => {
        const other: StatBonus[] = [{ stat: 'hp', percentage: 30, mode: 'multiplier' }];
        const alone = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus, []);
        const withOther = previewStatBonus(stats, 'DEBUFFER_BOMBER', bonus, other);

        expect(withOther.baseScore).toBeGreaterThan(alone.baseScore);
        expect(withOther.baseScore).toBe(calculateRoleScore('DEBUFFER_BOMBER', stats, other));
        expect(withOther.newScore).toBe(
            calculateRoleScore('DEBUFFER_BOMBER', stats, [...other, bonus])
        );
    });

    it('works for additive mode too', () => {
        const additive: StatBonus = { stat: 'attack', percentage: 50, mode: 'additive' };
        const preview = previewStatBonus(stats, 'ATTACKER', additive);
        expect(preview.statValue).toBe(8000);
        expect(preview.newScore - preview.baseScore).toBeCloseTo(8000 * 0.5, 6);
    });

    // calculatePriorityScore only applies stat bonuses inside the ROLE formulas; with no
    // role it scores from the custom formula, which takes no bonuses at all. So a bonus is
    // genuinely inert in custom mode and the UI must not imply otherwise.
    it('reports applies=false when no role is selected', () => {
        const preview = previewStatBonus(stats, null, bonus);
        expect(preview.applies).toBe(false);
        expect(preview.statValue).toBeGreaterThan(0);
    });
});
