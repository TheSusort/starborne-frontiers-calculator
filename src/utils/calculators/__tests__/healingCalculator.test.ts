import { describe, it, expect } from 'vitest';
import { calculateHealing } from '../healingCalculator';

const BASE_CONFIG = {
    id: '1',
    name: 'Test',
    hp: 100000,
    healPercent: 20,
    chargedHealPercent: 0,
    chargeCount: 0,
    startCharged: false,
    crit: 0,
    critDamage: 100,
    healModifier: 0,
    buffs: [],
};

describe('calculateHealing', () => {
    it('baseline: no buffs gives HP × Heal%', () => {
        const result = calculateHealing(BASE_CONFIG);
        expect(result.activeEffectiveHealing).toBe(20000);
    });

    it('healModifier applies multiplicatively', () => {
        const result = calculateHealing({ ...BASE_CONFIG, healModifier: 20 });
        // 100000 × 0.20 × 1.20 = 24000
        expect(result.activeEffectiveHealing).toBe(24000);
    });

    it('outgoingHealBuff applies as separate multiplier after healModMult', () => {
        const result = calculateHealing(BASE_CONFIG, {
            critBuff: 0,
            critDamageBuff: 0,
            outgoingHealBuff: -50,
            incomingHealBuff: 0,
        });
        // 100000 × 0.20 × (1 + 0/100) × (1 + -50/100) = 20000 × 0.5 = 10000
        expect(result.activeEffectiveHealing).toBe(10000);
    });

    it('outgoingHealBuff compounds with healModifier', () => {
        const result = calculateHealing(
            { ...BASE_CONFIG, healModifier: 20 },
            { critBuff: 0, critDamageBuff: 0, outgoingHealBuff: 50, incomingHealBuff: 0 }
        );
        // 100000 × 0.20 × 1.20 × 1.50 = 36000
        expect(result.activeEffectiveHealing).toBe(36000);
    });

    it('no outgoingHealBuff field (buffs undefined) defaults to 1× multiplier', () => {
        const withBuff = calculateHealing(BASE_CONFIG, {
            critBuff: 0,
            critDamageBuff: 0,
            outgoingHealBuff: 0,
            incomingHealBuff: 0,
        });
        const withoutBuff = calculateHealing(BASE_CONFIG, undefined);
        expect(withBuff.activeEffectiveHealing).toBe(withoutBuff.activeEffectiveHealing);
    });
});
