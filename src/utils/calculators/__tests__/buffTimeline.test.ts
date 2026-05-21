import { describe, it, expect } from 'vitest';
import { computeChargeSchedule, computeBuffTimeline } from '../buffTimeline';
import { SelectedGameBuff } from '../../../types/calculator';

function makeBuff(id: string, overrides: Partial<SelectedGameBuff> = {}): SelectedGameBuff {
    return { id, buffName: id, stacks: 1, parsedEffects: {}, isStackable: false, ...overrides };
}

describe('computeChargeSchedule', () => {
    it('returns empty array for 0 rounds', () => {
        expect(computeChargeSchedule(2, false, 0)).toEqual([]);
    });

    it('returns empty array when chargeCount is 0', () => {
        expect(computeChargeSchedule(0, false, 5)).toEqual([]);
    });

    it('startCharged=false, chargeCount=2: charged on rounds 3,6', () => {
        expect(computeChargeSchedule(2, false, 6)).toEqual([3, 6]);
    });

    it('startCharged=true, chargeCount=2: charged on rounds 1,4,7', () => {
        expect(computeChargeSchedule(2, true, 7)).toEqual([1, 4, 7]);
    });

    it('chargeCount=1, startCharged=false: charged on rounds 2,4,6', () => {
        expect(computeChargeSchedule(1, false, 6)).toEqual([2, 4, 6]);
    });

    it('chargeCount=3, startCharged=false: charged on round 4,8', () => {
        expect(computeChargeSchedule(3, false, 8)).toEqual([4, 8]);
    });
});

describe('computeBuffTimeline', () => {
    it('returns one entry per round with correct round numbers', () => {
        const result = computeBuffTimeline([], [], 2, false, 3);
        expect(result).toHaveLength(3);
        expect(result[0].round).toBe(1);
        expect(result[2].round).toBe(3);
    });

    it('no buffs → empty lists every round', () => {
        const result = computeBuffTimeline([], [], 2, false, 2);
        expect(result[0].activeSelfBuffs).toEqual([]);
        expect(result[0].activeEnemyDebuffs).toEqual([]);
    });

    it('always-active buff (no skillSource) appears every round as recurring', () => {
        const buff = makeBuff('Overload');
        const result = computeBuffTimeline([buff], [], 2, false, 3);
        result.forEach((entry) => {
            expect(entry.activeSelfBuffs).toEqual([
                { buffName: 'Overload', turnsRemaining: 'recurring' },
            ]);
        });
    });

    it('passive buff appears every round as recurring', () => {
        const buff = makeBuff('Passive Atk', { skillSource: 'passive1' });
        const result = computeBuffTimeline([buff], [], 2, false, 2);
        expect(result[0].activeSelfBuffs[0]).toEqual({
            buffName: 'Passive Atk',
            turnsRemaining: 'recurring',
        });
        expect(result[1].activeSelfBuffs[0]).toEqual({
            buffName: 'Passive Atk',
            turnsRemaining: 'recurring',
        });
    });

    it('recurring-duration buff appears every round', () => {
        const buff = makeBuff('Speed Up', { skillSource: 'active', skillDuration: 'recurring' });
        const result = computeBuffTimeline([buff], [], 2, false, 2);
        expect(result[0].activeSelfBuffs[0]).toEqual({
            buffName: 'Speed Up',
            turnsRemaining: 'recurring',
        });
        expect(result[1].activeSelfBuffs[0]).toEqual({
            buffName: 'Speed Up',
            turnsRemaining: 'recurring',
        });
    });

    it('active buff (1t) applies each active round and expires before the next', () => {
        // chargeCount=2: r1=active, r2=active, r3=charged, r4=active
        const buff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const result = computeBuffTimeline([buff], [], 2, false, 4);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        expect(result[1].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        expect(result[2].activeSelfBuffs).toEqual([]); // r3: charged, no active buff
        expect(result[3].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
    });

    it('charge buff applies on charge rounds only and decrements each round', () => {
        // chargeCount=2, startCharged=false: r3 and r6 are charged
        const buff = makeBuff('Crit Power', { skillSource: 'charge', skillDuration: 2 });
        const result = computeBuffTimeline([buff], [], 2, false, 6);
        expect(result[0].activeSelfBuffs).toEqual([]); // r1: no buff
        expect(result[1].activeSelfBuffs).toEqual([]); // r2: no buff
        expect(result[2].activeSelfBuffs).toEqual([{ buffName: 'Crit Power', turnsRemaining: 2 }]); // r3: charged
        expect(result[3].activeSelfBuffs).toEqual([{ buffName: 'Crit Power', turnsRemaining: 1 }]); // r4: 1t left
        expect(result[4].activeSelfBuffs).toEqual([]); // r5: expired
        expect(result[5].activeSelfBuffs).toEqual([{ buffName: 'Crit Power', turnsRemaining: 2 }]); // r6: reapplied
    });

    it('enemy debuffs tracked separately', () => {
        const selfBuff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const enemyDebuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
        const result = computeBuffTimeline([selfBuff], [enemyDebuff], 2, false, 1);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        expect(result[0].activeEnemyDebuffs).toEqual([{ buffName: 'Def Down', turnsRemaining: 1 }]);
    });

    it('higher tier replaces lower tier of same family', () => {
        // Active: Attack Up I (1t), Charge: Attack Up III (2t), chargeCount=2
        const activeI = makeBuff('Attack Up I', { skillSource: 'active', skillDuration: 1 });
        const chargeIII = makeBuff('Attack Up III', { skillSource: 'charge', skillDuration: 2 });
        const result = computeBuffTimeline([activeI, chargeIII], [], 2, false, 6);
        expect(result[0].activeSelfBuffs[0]).toMatchObject({ buffName: 'Attack Up I' });
        expect(result[1].activeSelfBuffs[0]).toMatchObject({ buffName: 'Attack Up I' });
        // r3: charged fires Attack Up III (tier 3 > tier 1) → replaces
        expect(result[2].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up III',
            turnsRemaining: 2,
        });
        // r4: active fires Attack Up I (tier 1 < tier 3 in map) → skip
        expect(result[3].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up III',
            turnsRemaining: 1,
        });
        // r5: III expires, active fires I → apply
        expect(result[4].activeSelfBuffs[0]).toMatchObject({ buffName: 'Attack Up I' });
        // r6: charged fires III again
        expect(result[5].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up III',
            turnsRemaining: 2,
        });
    });

    it('same tier does not refresh the buff', () => {
        // Active: Attack Up II (2t), chargeCount=2
        const buff = makeBuff('Attack Up II', { skillSource: 'active', skillDuration: 2 });
        const result = computeBuffTimeline([buff], [], 2, false, 4);
        expect(result[0].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up II',
            turnsRemaining: 2,
        });
        // r2: decrement→1, active fires II (tier 2 ≥ tier 2) → skip
        expect(result[1].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up II',
            turnsRemaining: 1,
        });
        // r3: decrement→0 deleted, charged fires (no buff)
        expect(result[2].activeSelfBuffs).toEqual([]);
        // r4: active fires → fresh application
        expect(result[3].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up II',
            turnsRemaining: 2,
        });
    });

    it('startCharged=true fires charged on round 1', () => {
        const buff = makeBuff('Crit Power', { skillSource: 'charge', skillDuration: 1 });
        const result = computeBuffTimeline([buff], [], 2, true, 1);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Crit Power', turnsRemaining: 1 }]);
    });

    it('deduplicates always-active buffs with the same buffName', () => {
        const buff1 = makeBuff('Overload');
        const buff2 = makeBuff('Overload'); // same name, different instance
        const result = computeBuffTimeline([buff1, buff2], [], 2, false, 2);
        expect(result[0].activeSelfBuffs).toHaveLength(1);
        expect(result[0].activeSelfBuffs[0]).toEqual({
            buffName: 'Overload',
            turnsRemaining: 'recurring',
        });
    });
});
