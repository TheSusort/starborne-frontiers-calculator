import { describe, it, expect } from 'vitest';
import { reflectedDamageForHit, reflectedDamageParts } from '../damageReflection';
import { NO_INCOMING_REDUCTION } from '../victimDamage';
import { calculateDamageReduction } from '../../autogear/statResolution';

describe('reflectedDamageForHit', () => {
    it('returns 0 when reflectPct is 0', () => {
        const r = reflectedDamageForHit({
            reflectPct: 0,
            reflectBase: 5000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        expect(r).toBe(0);
    });

    it('returns 0 when reflectBase is 0', () => {
        const r = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 0,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        expect(r).toBe(0);
    });

    // #678 measurement: Belladonna (attack 4598, defence 3647) hits Nosorog (16%) with her 140% active.
    // In game Nosorog reflected 504; the model gives 504.4.
    it('reflects 16% of the 140% hit Belladonna threw, through her own defence', () => {
        const base = 1.4 * 4598;
        const { damage } = reflectedDamageParts({
            reflectPct: 16,
            reflectBase: base,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: calculateDamageReduction(3647),
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        expect(damage).toBeCloseTo(0.16 * base * (1 - calculateDamageReduction(3647) / 100), 6);
        expect(Math.abs(damage - 504)).toBeLessThan(1);
    });

    it("scales with the reflector's Out. Damage Up (Nosorog with Out. Damage Up III: x1.45)", () => {
        const args = {
            reflectPct: 16,
            reflectBase: 1000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        };
        const plain = reflectedDamageParts(args);
        const buffed = reflectedDamageParts({ ...args, reflectorOutgoingPct: 45 });
        expect(buffed.damage).toBeCloseTo(plain.damage * 1.45, 6);
        expect(buffed.preMitigation).toBeCloseTo(plain.preMitigation * 1.45, 6);
    });

    it('reflects nothing from a zero base or a zero percentage', () => {
        const args = {
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        };
        expect(reflectedDamageParts({ ...args, reflectPct: 16, reflectBase: 0 })).toEqual({
            damage: 0,
            preMitigation: 0,
            incomingFactor: 1,
        });
        expect(reflectedDamageParts({ ...args, reflectPct: 0, reflectBase: 1000 })).toEqual({
            damage: 0,
            preMitigation: 0,
            incomingFactor: 1,
        });
    });

    it('affinity advantage (+25) increases damage vs neutral', () => {
        const neutral = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        const advantage = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: 25,
            attackerDefenceReductionPct: 40,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        expect(advantage).toBeGreaterThan(neutral);
    });

    it('affinity disadvantage (-25) decreases damage vs neutral', () => {
        const neutral = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 40,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        const disadvantage = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: -25,
            attackerDefenceReductionPct: 40,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        expect(disadvantage).toBeLessThan(neutral);
    });

    it('defence reduction of 0 applies no mitigation (factor = 1)', () => {
        const withDefence = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 50,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        const noDefence = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        // No defence reduction should yield more damage than with 50% DR
        expect(noDefence).toBeGreaterThan(withDefence);
        // Specifically: 10% * 10000 * 1.0 * 1.0 * 1.0 = 1000
        expect(noDefence).toBeCloseTo(1000, 5);
    });

    it('incoming reduction of 50% halves the result', () => {
        const base = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimReduction: NO_INCOMING_REDUCTION,
        });
        const halved = reflectedDamageForHit({
            reflectPct: 10,
            reflectBase: 10000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
            reflectVictimReduction: { passivePct: 50, separatePcts: [] },
        });
        expect(halved).toBeCloseTo(base / 2, 5);
    });

    describe('composed recipient reductions (capped)', () => {
        const base = {
            reflectPct: 100,
            reflectBase: 1000,
            affinityDamageModifier: 0,
            attackerDefenceReductionPct: 0,
        };

        it('multiplies the status channel with the passive bucket', () => {
            const r = reflectedDamageParts({
                ...base,
                reflectVictimReduction: { passivePct: 40, separatePcts: [] },
                incomingDamageModifierPct: -30,
                victimSideIncomingPct: -30,
            });
            expect(r.damage).toBeCloseTo(420, 6);
            expect(r.preMitigation).toBeCloseTo(1000, 6);
        });

        it('floors the composed factor at a 70% reduction', () => {
            const r = reflectedDamageParts({
                ...base,
                reflectVictimReduction: { passivePct: 40, separatePcts: [20] },
                incomingDamageModifierPct: -45,
                victimSideIncomingPct: -45,
            });
            expect(r.damage).toBeCloseTo(300, 6);
            expect(r.preMitigation).toBeCloseTo(1000, 6);
        });

        it('applies a passive-only recipient (gear-set share) without a status channel', () => {
            const r = reflectedDamageParts({
                ...base,
                reflectVictimReduction: { passivePct: 25, separatePcts: [] },
            });
            expect(r.damage).toBeCloseTo(750, 6);
            expect(r.preMitigation).toBeCloseTo(1000, 6);
        });
    });
});
