import { describe, it, expect } from 'vitest';
import { flatInputToAbilities } from '../flatInputToAbilities';
import { DPSSimulationInput } from '../../calculators/dpsSimulator';

const base: DPSSimulationInput = {
    attack: 1000,
    crit: 100,
    critDamage: 0,
    defensePenetration: 0,
    activeMultiplier: 180,
    chargedMultiplier: 350,
    chargeCount: 3,
    activeDoTs: [],
    chargedDoTs: [],
    enemyDefense: 0,
    enemyHp: 500000,
    rounds: 10,
    selfBuffs: [],
    enemyDebuffs: [],
};

describe('flatInputToAbilities', () => {
    it('builds an active damage ability and a charged damage ability with the right multipliers', () => {
        const skills = flatInputToAbilities(base);

        const active = skills.slots.find((s) => s.slot === 'active');
        const charged = skills.slots.find((s) => s.slot === 'charged');

        expect(active).toBeDefined();
        expect(charged).toBeDefined();

        const activeDamage = active!.abilities[0];
        expect(activeDamage.config).toEqual({ type: 'damage', multiplier: 180 });
        expect(activeDamage.target).toBe('enemy');
        expect(activeDamage.trigger).toBe('on-cast');

        const chargedDamage = charged!.abilities[0];
        expect(chargedDamage.config).toEqual({ type: 'damage', multiplier: 350 });
    });

    it('maps activeSecondary to an additional-damage ability on the active slot', () => {
        const skills = flatInputToAbilities({
            ...base,
            activeSecondary: { stat: 'defense', pct: 80 },
        });

        const active = skills.slots.find((s) => s.slot === 'active');
        const additional = active!.abilities.find((a) => a.type === 'additional-damage');
        expect(additional).toBeDefined();
        expect(additional!.config).toEqual({ type: 'additional-damage', stat: 'defense', pct: 80 });
        expect(additional!.target).toBe('enemy');
    });

    it('maps activeConditional onto the active damage ability with conditions + scaling', () => {
        const skills = flatInputToAbilities({
            ...base,
            activeConditional: { pct: 20, condition: 'enemy-debuff', derivable: true, cap: 100 },
        });

        const active = skills.slots.find((s) => s.slot === 'active');
        const damage = active!.abilities[0];
        expect(damage.conditions).toEqual([{ subject: 'enemy-debuff', derivable: true }]);
        expect(damage.scaling).toEqual({ conditionIndex: 0, perUnit: 20, cap: 100 });
    });

    it('maps selfChargeGain to a charge ability targeting self', () => {
        const skills = flatInputToAbilities({
            ...base,
            selfChargeGain: { amount: 1, condition: 'always', derivable: true },
        });

        const active = skills.slots.find((s) => s.slot === 'active');
        const charge = active!.abilities.find((a) => a.type === 'charge');
        expect(charge).toBeDefined();
        expect(charge!.target).toBe('self');
        expect(charge!.config).toEqual({ type: 'charge', amount: 1 });
        expect(charge!.conditions).toEqual([{ subject: 'always', derivable: true }]);
    });

    it('maps activeDoTs to dot abilities on the active slot', () => {
        const skills = flatInputToAbilities({
            ...base,
            activeDoTs: [{ id: 'x', type: 'corrosion', tier: 3, stacks: 1, duration: 2 }],
        });

        const active = skills.slots.find((s) => s.slot === 'active');
        const dot = active!.abilities.find((a) => a.type === 'dot');
        expect(dot).toBeDefined();
        expect(dot!.config).toEqual({
            type: 'dot',
            dotType: 'corrosion',
            tier: 3,
            stacks: 1,
            duration: 2,
        });
    });

    it('omits the charged slot when there is no charged skill', () => {
        const skills = flatInputToAbilities({
            ...base,
            chargedMultiplier: 0,
            chargeCount: 0,
        });

        expect(skills.slots.find((s) => s.slot === 'charged')).toBeUndefined();
        expect(skills.slots.find((s) => s.slot === 'active')).toBeDefined();
    });

    it('passes conditional derivable / manualCount through verbatim', () => {
        const skills = flatInputToAbilities({
            ...base,
            activeConditional: {
                pct: 15,
                condition: 'enemy-buff',
                derivable: false,
                manualCount: 2,
            },
        });

        const active = skills.slots.find((s) => s.slot === 'active');
        const damage = active!.abilities[0];
        expect(damage.conditions).toEqual([
            { subject: 'enemy-buff', derivable: false, manualCount: 2 },
        ]);
    });

    it('maps chargedConditional + chargedSecondary onto the charged slot', () => {
        const s = flatInputToAbilities({
            ...base,
            chargedSecondary: { stat: 'hp', pct: 50 },
            chargedConditional: { pct: 15, condition: 'enemy-debuff', derivable: true },
        });
        const charged = s.slots.find((x) => x.slot === 'charged')!;
        expect(charged.abilities.find((a) => a.type === 'additional-damage')!.config).toMatchObject(
            { stat: 'hp', pct: 50 }
        );
        const dmg = charged.abilities.find((a) => a.type === 'damage')!;
        expect(dmg.scaling).toMatchObject({ conditionIndex: 0, perUnit: 15 });
        expect(dmg.conditions[0]).toMatchObject({ subject: 'enemy-debuff', derivable: true });
    });

    it('emits active abilities in order: damage, additional-damage, dot, charge', () => {
        const s = flatInputToAbilities({
            ...base,
            activeSecondary: { stat: 'defense', pct: 80 },
            activeDoTs: [{ id: 'x', type: 'corrosion', tier: 3, stacks: 1, duration: 2 }],
            selfChargeGain: { amount: 1, condition: 'always', derivable: true },
        });
        const active = s.slots.find((x) => x.slot === 'active')!;
        expect(active.abilities.map((a) => a.type)).toEqual([
            'damage',
            'additional-damage',
            'dot',
            'charge',
        ]);
    });
});
