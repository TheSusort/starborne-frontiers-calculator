import { describe, it, expect } from 'vitest';
import { reflectedDamageForHit } from '../damageReflection';
import { calculateDamageReduction } from '../../autogear/priorityScore';

describe('reflectedDamageForHit', () => {
    it('returns 0 when reflectPct is 0', () => {
        const r = reflectedDamageForHit({
            reflectPct: 0,
            netHpDamage: 5000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimIncomingReductionPct: 0,
        });
        expect(r).toBe(0);
    });

    it('returns 0 when netHpDamage is 0', () => {
        const r = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 0,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimIncomingReductionPct: 0,
        });
        expect(r).toBe(0);
    });

    it('matches duel 1 (def 3001 → DR ~45.8%, disadvantage -25)', () => {
        const r = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 28056,
            affinityDamageModifier: -25,
            attackerDefenceReductionPct: calculateDamageReduction(3001),
            reflectVictimIncomingReductionPct: 0,
        });
        expect(r).toBeGreaterThan(1100);
        expect(r).toBeLessThan(1180); // ≈1141
    });

    it('matches duel 2 (def 4093 → DR ~53.4%, neutral affinity)', () => {
        const r = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 48318,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: calculateDamageReduction(4093),
            reflectVictimIncomingReductionPct: 0,
        });
        expect(r).toBeGreaterThan(2200);
        expect(r).toBeLessThan(2300); // ≈2252
    });

    it('affinity advantage (+25) increases damage vs neutral', () => {
        const neutral = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimIncomingReductionPct: 0,
        });
        const advantage = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: 25,
            attackerDefenceReductionPct: 40,
            reflectVictimIncomingReductionPct: 0,
        });
        expect(advantage).toBeGreaterThan(neutral);
    });

    it('affinity disadvantage (-25) decreases damage vs neutral', () => {
        const neutral = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimIncomingReductionPct: 0,
        });
        const disadvantage = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: -25,
            attackerDefenceReductionPct: 40,
            reflectVictimIncomingReductionPct: 0,
        });
        expect(disadvantage).toBeLessThan(neutral);
    });

    it('defence reduction of 0 applies no mitigation (factor = 1)', () => {
        const withDefence = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 50,
            reflectVictimIncomingReductionPct: 0,
        });
        const noDefence = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimIncomingReductionPct: 0,
        });
        // No defence reduction should yield more damage than with 50% DR
        expect(noDefence).toBeGreaterThan(withDefence);
        // Specifically: 10% * 10000 * 1.0 * 1.0 * 1.0 = 1000
        expect(noDefence).toBeCloseTo(1000, 5);
    });

    it('incoming reduction of 50% halves the result', () => {
        const base = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimIncomingReductionPct: 0,
        });
        const halved = reflectedDamageForHit({
            reflectPct: 10,
            netHpDamage: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimIncomingReductionPct: 50,
        });
        expect(halved).toBeCloseTo(base / 2, 5);
    });
});
