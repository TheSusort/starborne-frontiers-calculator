import { describe, it, expect } from 'vitest';
import { thresholdShieldForHit } from '../thresholdShield';
import type { Ability } from '../../../types/abilities';

const ability = (
    overrides: Partial<{ flatAmount: number; attackPct: number; hpThresholdPct: number }> = {}
): Ability => ({
    id: 'lifeline-1',
    type: 'incoming-shield-grant',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-shield-grant',
        hpThresholdPct: overrides.hpThresholdPct ?? 30,
        flatAmount: overrides.flatAmount ?? 8000,
        attackPct: overrides.attackPct ?? 100,
        oncePerCombat: true,
    },
});

const base = {
    abilities: [ability()],
    maxHp: 10000,
    effectiveAttack: 2000,
    isDirect: true,
    alreadyFired: () => false,
};

describe('thresholdShieldForHit', () => {
    it('fires on a downward crossing below the threshold', () => {
        // currentHp 4000 (40% >= 30%), hit deals 2000 to HP -> 2000 (20% < 30%) => crossing
        const r = thresholdShieldForHit({ ...base, currentHp: 4000, provisionalHpDamage: 2000 });
        expect(r).not.toBeNull();
        expect(r!.grant).toBe(8000 + 2000); // flat + 100% attack
        expect(r!.abilityId).toBe('lifeline-1');
    });

    it('does not fire when already below the threshold pre-hit', () => {
        // currentHp 2500 (25% < 30%) -> not a downward crossing
        const r = thresholdShieldForHit({ ...base, currentHp: 2500, provisionalHpDamage: 1000 });
        expect(r).toBeNull();
    });

    it('does not fire when the hit does not cross the threshold', () => {
        // currentHp 8000 -> 6000 (60% >= 30%)
        const r = thresholdShieldForHit({ ...base, currentHp: 8000, provisionalHpDamage: 2000 });
        expect(r).toBeNull();
    });

    it('fires when pre-hit HP sits exactly on the threshold (>= is inclusive)', () => {
        // currentHp 3000 (exactly 30%), hit drops it to 2999 (< 30%) => crossing
        const r = thresholdShieldForHit({ ...base, currentHp: 3000, provisionalHpDamage: 1 });
        expect(r).not.toBeNull();
    });

    it('does not fire when the hit lands HP exactly on the threshold (< is exclusive)', () => {
        // currentHp 5000 -> 3000 (exactly 30%): "at" 30% has not "crossed below"
        const r = thresholdShieldForHit({ ...base, currentHp: 5000, provisionalHpDamage: 2000 });
        expect(r).toBeNull();
    });

    it('does not fire for non-direct damage (DoT / bomb)', () => {
        const r = thresholdShieldForHit({
            ...base,
            currentHp: 4000,
            provisionalHpDamage: 2000,
            isDirect: false,
        });
        expect(r).toBeNull();
    });

    it('does not fire when already fired this battle', () => {
        const r = thresholdShieldForHit({
            ...base,
            currentHp: 4000,
            provisionalHpDamage: 2000,
            alreadyFired: () => true,
        });
        expect(r).toBeNull();
    });

    it('returns the raw (uncapped) grant — the engine applies the maxHP cap', () => {
        const r = thresholdShieldForHit({
            ...base,
            currentHp: 4000,
            provisionalHpDamage: 2000,
            effectiveAttack: 50000,
        });
        expect(r!.grant).toBe(8000 + 50000); // uncapped; cap is applied at the engine seam
    });
});
