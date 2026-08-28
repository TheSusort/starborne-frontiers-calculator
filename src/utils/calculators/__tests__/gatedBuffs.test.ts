import { describe, it, expect } from 'vitest';
import { gatedAutoFilledBuffs } from '../gatedBuffs';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { ShipSkills } from '../../../types/abilities';

const buff = (over: Partial<SelectedGameBuff> = {}): SelectedGameBuff => ({
    id: 'Defense Up II-passive1-self',
    buffName: 'Defense Up II',
    stacks: 1,
    parsedEffects: { defense: 30 },
    isStackable: false,
    autoFilled: true,
    skillSource: 'passive1',
    ...over,
});

const skills = (abilities: unknown[]): ShipSkills =>
    ({ slots: [{ slot: 'passive', abilities }] }) as unknown as ShipSkills;

const gatedAbility = {
    config: { type: 'buff', buffName: 'Defense Up II' },
    conditions: [
        {
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: 60,
            hpSubject: 'self',
        },
    ],
};
const ungatedAbility = { config: { type: 'buff', buffName: 'Defense Up II' }, conditions: [] };

describe('gatedAutoFilledBuffs', () => {
    it('reports an auto-filled buff whose ability carries an HP gate, with the reason in words', () => {
        const result = gatedAutoFilledBuffs([buff()], skills([gatedAbility]));
        expect(result).toEqual([
            {
                buffId: 'Defense Up II-passive1-self',
                buffName: 'Defense Up II',
                reason: 'below 60% HP',
            },
        ]);
    });

    it('never reports a MANUALLY added buff, gate or no gate', () => {
        expect(gatedAutoFilledBuffs([buff({ autoFilled: false })], skills([gatedAbility]))).toEqual(
            []
        );
        expect(
            gatedAutoFilledBuffs([buff({ autoFilled: undefined })], skills([gatedAbility]))
        ).toEqual([]);
    });

    it('does NOT report a buff that also has an UNGATED grant path', () => {
        // Skill.slot has three values against skillSource's five, so all three passives collapse
        // into one slot and a name can match more than one ability. If ANY path is unconditional
        // the buff genuinely can stand always-on and must keep counting.
        expect(gatedAutoFilledBuffs([buff()], skills([gatedAbility, ungatedAbility]))).toEqual([]);
    });

    it('does NOT report a buff gated in one slot when a DIFFERENT slot grants it unconditionally', () => {
        // Panon's shape: Barrier is gated behind Taunt/Provoke from the CHARGE slot, but granted
        // unconditionally from the PASSIVE slot. The every-match rule must see across ALL slots,
        // not just the one `skillSource` nominally maps to, or it drops a buff the ship also
        // grants for free.
        const multiSlot = {
            slots: [
                { slot: 'charged', abilities: [gatedAbility] },
                { slot: 'passive', abilities: [ungatedAbility] },
            ],
        } as unknown as ShipSkills;
        expect(gatedAutoFilledBuffs([buff({ skillSource: 'charge' })], multiSlot)).toEqual([]);
    });

    it('ignores a subject:"always" condition — that is not a gate', () => {
        const alwaysAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [{ subject: 'always', derivable: true }],
        };
        expect(gatedAutoFilledBuffs([buff()], skills([alwaysAbility]))).toEqual([]);
    });

    it('finds a matching ability regardless of which slot it lives in', () => {
        const charged = {
            slots: [{ slot: 'charged', abilities: [gatedAbility] }],
        } as unknown as ShipSkills;
        expect(gatedAutoFilledBuffs([buff({ skillSource: 'charge' })], charged)).toHaveLength(1);
        expect(
            gatedAutoFilledBuffs([buff({ skillSource: 'passive3' })], skills([gatedAbility]))
        ).toHaveLength(1);
    });

    it('reports nothing when the buff has no matching ability at all', () => {
        expect(
            gatedAutoFilledBuffs([buff({ buffName: 'Attack Up II' })], skills([gatedAbility]))
        ).toEqual([]);
    });

    it('reports nothing for an absent shipSkills (a manual config with no ship)', () => {
        expect(gatedAutoFilledBuffs([buff()], undefined)).toEqual([]);
    });

    it('joins an anyOf OR-run with "or", not ", " — Panon\'s "Provoked or Taunted" shape', () => {
        // The second condition carries anyOf:true, meaning it is an ALTERNATIVE to the first,
        // not an additional AND-ed requirement. ', ' would overclaim the gate as stricter than
        // the game rule ("while Taunt is active, while affected by Provoke" reads as needing
        // BOTH).
        // Matches the real producer's shape (buildShipAbilities.ts's affectedByConditions /
        // statusEffectCondition): BOTH conditions in an OR-alternation carry anyOf:true, not
        // just the second one.
        const orGatedAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [
                { subject: 'self-debuff', derivable: true, buffName: 'Provoke', anyOf: true },
                { subject: 'self-buff', derivable: true, buffName: 'Taunt', anyOf: true },
            ],
        };
        const result = gatedAutoFilledBuffs([buff()], skills([orGatedAbility]));
        expect(result).toEqual([
            {
                buffId: 'Defense Up II-passive1-self',
                buffName: 'Defense Up II',
                reason: 'while affected by Provoke or while Taunt is active',
            },
        ]);
    });

    it('keeps AND-joining with ", " for non-anyOf conditions on the same ability', () => {
        const andGatedAbility = {
            config: { type: 'buff', buffName: 'Defense Up II' },
            conditions: [
                {
                    subject: 'hp-threshold',
                    derivable: true,
                    hpComparator: 'below',
                    hpPercent: 60,
                    hpSubject: 'self',
                },
                { subject: 'self-buff', derivable: true, buffName: 'Taunt' },
            ],
        };
        const result = gatedAutoFilledBuffs([buff()], skills([andGatedAbility]));
        expect(result).toEqual([
            {
                buffId: 'Defense Up II-passive1-self',
                buffName: 'Defense Up II',
                reason: 'below 60% HP, while Taunt is active',
            },
        ]);
    });
});
