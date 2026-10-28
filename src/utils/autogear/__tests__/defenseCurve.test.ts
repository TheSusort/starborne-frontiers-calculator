import { describe, expect, it } from 'vitest';
import { calculateDamageReduction, defenseForDamageReduction } from '../statResolution';

const hitThrough = (raw: number, defense: number) =>
    raw * (1 - calculateDamageReduction(defense) / 100);

describe('calculateDamageReduction against owner-measured in-game hits', () => {
    // Custodian L60 (attack 1,718.85, 0% crit) first active at 90%, one target each.
    const custodian = 1718.85 * 0.9;
    it.each([
        ['Forsythia L10', 345.1, 1, 1408],
        ['Chisel L20', 636.65, 1, 1309],
        ['Chisel L40', 1710.03, 1, 1039],
        ['Bedrock L10 (affinity disadvantage)', 280.84, 0.75, 1074],
        ['Warden L60', 9096.69, 1, 430],
        ['Isha L60', 15317.5, 1, 288],
        ['Isha L60 under Defense Up III (+45%)', 15317.5 * 1.45, 1, 211],
    ])('Custodian vs %s', (_name, defense, affinity, measured) => {
        expect(Math.abs(hitThrough(custodian * affinity, defense) - measured)).toBeLessThan(1);
    });

    it('Judge (attack 25,977, 230%, crit power 240%, 27% pen) vs Yazid (defence 13,568)', () => {
        const hit = hitThrough(25977 * 2.3 * 3.4, 13568.12 * 0.73);
        expect(Math.abs(hit - 53041)).toBeLessThan(1);
    });

    it('Wusheng (attack 7,912) 200% active, non-crit and crit, vs Yazid', () => {
        expect(Math.abs(hitThrough(7912 * 2, 13568.12) - 3245)).toBeLessThan(1);
        expect(Math.abs(hitThrough(7912 * 2 * 2.34, 13568.12) - 7594)).toBeLessThan(1.5);
    });
});

describe('calculateDamageReduction bounds', () => {
    it('is 0 at or below zero defence, never a bonus', () => {
        expect(calculateDamageReduction(0)).toBe(0);
        expect(calculateDamageReduction(-5000)).toBe(0);
    });

    it('rises monotonically and stays below 100', () => {
        let prev = 0;
        for (const d of [1, 100, 1000, 3500, 10_000, 50_000, 1_000_000]) {
            const dr = calculateDamageReduction(d);
            expect(dr).toBeGreaterThan(prev);
            expect(dr).toBeLessThan(100);
            prev = dr;
        }
        expect(calculateDamageReduction(3500)).toBe(50);
    });

    it('defenseForDamageReduction inverts it', () => {
        for (const d of [10, 637, 9097, 22_210]) {
            expect(defenseForDamageReduction(calculateDamageReduction(d))).toBeCloseTo(d, 6);
        }
        expect(defenseForDamageReduction(0)).toBe(0);
        expect(defenseForDamageReduction(100)).toBe(Infinity);
    });
});
