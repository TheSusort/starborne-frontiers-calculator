import { describe, it, expect } from 'vitest';
import { calculateRoleScore } from '../priorityScore';

const baseStats = {
    hp: 100000,
    attack: 50000,
    defence: 30000,
    hacking: 200,
    security: 200,
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

describe('calculateRoleScore', () => {
    it('returns a positive number for ATTACKER role', () => {
        expect(calculateRoleScore('ATTACKER', baseStats)).toBeGreaterThan(0);
    });

    it('returns a positive number for DEFENDER role', () => {
        expect(calculateRoleScore('DEFENDER', baseStats)).toBeGreaterThan(0);
    });

    it('returns a positive number for DEBUFFER role', () => {
        expect(calculateRoleScore('DEBUFFER', baseStats)).toBeGreaterThan(0);
    });

    it('returns a positive number for SUPPORTER role', () => {
        expect(calculateRoleScore('SUPPORTER', baseStats)).toBeGreaterThan(0);
    });

    it('returns a higher ATTACKER score when attack is higher', () => {
        const higherAttack = { ...baseStats, attack: 100000 };
        expect(calculateRoleScore('ATTACKER', higherAttack)).toBeGreaterThan(
            calculateRoleScore('ATTACKER', baseStats)
        );
    });

    it('returns a higher DEFENDER score when HP is higher', () => {
        const higherHP = { ...baseStats, hp: 200000 };
        expect(calculateRoleScore('DEFENDER', higherHP)).toBeGreaterThan(
            calculateRoleScore('DEFENDER', baseStats)
        );
    });

    it('returns 0 for an unknown role', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        expect(calculateRoleScore('UNKNOWN_ROLE' as any, baseStats)).toBe(0);
    });
});
