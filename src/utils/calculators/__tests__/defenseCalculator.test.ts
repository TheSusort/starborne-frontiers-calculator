import { describe, it, expect } from 'vitest';
import { computeBuffedStats } from '../defenseCalculator';
import { calculateEffectiveHP } from '../../autogear/statResolution';

const hp = 50000;
const defence = 8000;

describe('computeBuffedStats — incoming damage composition (#673)', () => {
    const baseEHP = calculateEffectiveHP(hp, defence);

    it('a buff-only channel keeps 1 / (1 + buff)', () => {
        const r = computeBuffedStats(hp, defence, 0, {
            defenseBuff: 0,
            incomingDamageBuff: -20,
            securityBuff: 0,
        });
        expect(r.effectiveHP).toBeCloseTo(baseEHP / 0.8, 6);
    });

    it('floors the incoming factor at 0.30 instead of diverging', () => {
        // Inc. Damage Down III (-45) + 4 Warding Screen (-20) + another -20 = -85.
        const r = computeBuffedStats(hp, defence, 0, {
            defenseBuff: 0,
            incomingDamageBuff: -85,
            securityBuff: 0,
        });
        expect(r.effectiveHP).toBeCloseTo(baseEHP / 0.3, 6);
    });

    it('binds the floor on the buff x crit-reduction product', () => {
        // 0.5 * 0.4 = 0.2 -> floored to 0.30.
        const r = computeBuffedStats(
            hp,
            defence,
            0,
            { defenseBuff: 0, incomingDamageBuff: -50, securityBuff: 0 },
            60
        );
        expect(r.effectiveHP).toBeCloseTo(baseEHP / 0.3, 6);
    });

    it('applies crit reduction as a divisor with no buffs', () => {
        const r = computeBuffedStats(hp, defence, 0, undefined, 35);
        expect(r.effectiveHP).toBeCloseTo(baseEHP / 0.65, 6);
    });
});
