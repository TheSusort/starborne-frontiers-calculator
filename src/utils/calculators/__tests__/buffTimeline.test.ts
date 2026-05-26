import { describe, it, expect } from 'vitest';
import { computeChargeSchedule, computeBuffTimeline } from '../buffTimeline';
import { SelectedGameBuff } from '../../../types/calculator';

function makeBuff(id: string, overrides: Partial<SelectedGameBuff> = {}): SelectedGameBuff {
    return { id, buffName: id, stacks: 1, parsedEffects: {}, isStackable: false, ...overrides };
}

function makeAccumBuff(
    id: string,
    trigger: 'per-round' | 'per-active' | 'per-charge',
    overrides: Partial<SelectedGameBuff> = {}
): SelectedGameBuff {
    return {
        id,
        buffName: id,
        stacks: 1,
        parsedEffects: {},
        isStackable: true,
        stackTrigger: trigger,
        ...overrides,
    };
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

    it('enemy debuff uses source ship schedule, not current ship schedule', () => {
        // Current ship (Los): startCharged=true, chargeCount=2 → Round 1 is charge
        // Source ship (Judge): startCharged=false, chargeCount=2 → Round 1 is active
        // Concentrate Fire (active, 1t) should fire based on Judge's schedule, so Round 1 is active for it
        const concentrateFire = makeBuff('Concentrate Fire', {
            skillSource: 'active',
            skillDuration: 1,
            sourceChargeCount: 2,
            sourceStartCharged: false,
        });
        const result = computeBuffTimeline([], [concentrateFire], 2, true, 3);
        // Round 1: charge for Los, but active for Judge → CF fires
        expect(result[0].activeEnemyDebuffs).toEqual([
            { buffName: 'Concentrate Fire', turnsRemaining: 1 },
        ]);
        // Round 2: active for Los, active for Judge → CF fires (re-applied after expiry)
        expect(result[1].activeEnemyDebuffs).toEqual([
            { buffName: 'Concentrate Fire', turnsRemaining: 1 },
        ]);
        // Round 3: active for Los, charge for Judge (chargeCount=2, so round 3 is charge) → CF does NOT fire
        expect(result[2].activeEnemyDebuffs).toEqual([]);
    });

    it('enemy debuff without source schedule falls back to current ship schedule', () => {
        // No sourceChargeCount/sourceStartCharged → uses current ship's chargedSet
        // Current ship: startCharged=true, chargeCount=2 → Round 1 is charge
        const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
        const result = computeBuffTimeline([], [debuff], 2, true, 1);
        // Round 1 is charge for current ship, active debuff does not fire
        expect(result[0].activeEnemyDebuffs).toEqual([]);
    });

    it('enemy debuffs tracked separately', () => {
        const selfBuff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const enemyDebuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
        const result = computeBuffTimeline([selfBuff], [enemyDebuff], 2, false, 1);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        expect(result[0].activeEnemyDebuffs).toEqual([{ buffName: 'Def Down', turnsRemaining: 1 }]);
    });

    it('DoT tiers stack independently — Inferno I and Inferno II coexist', () => {
        // Both applied on active; they are separate entities, neither overwrites the other
        const infernoI = makeBuff('Inferno I', { skillSource: 'active', skillDuration: 2 });
        const infernoII = makeBuff('Inferno II', { skillSource: 'active', skillDuration: 2 });
        const result = computeBuffTimeline([], [infernoI, infernoII], 0, false, 1);
        expect(result[0].activeEnemyDebuffs).toHaveLength(2);
        expect(result[0].activeEnemyDebuffs).toEqual(
            expect.arrayContaining([
                { buffName: 'Inferno I', turnsRemaining: 2 },
                { buffName: 'Inferno II', turnsRemaining: 2 },
            ])
        );
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

    it('same tier re-application refreshes duration', () => {
        // Active: Attack Up II (2t), chargeCount=2 → r1,r2 active; r3 charged; r4 active
        const buff = makeBuff('Attack Up II', { skillSource: 'active', skillDuration: 2 });
        const result = computeBuffTimeline([buff], [], 2, false, 4);
        // r1: applied fresh → 2
        expect(result[0].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up II',
            turnsRemaining: 2,
        });
        // r2: decrement→1, active fires same tier → refreshed to 2
        expect(result[1].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up II',
            turnsRemaining: 2,
        });
        // r3: decrement→1, charged fires (no active buff applies) → stays at 1
        expect(result[2].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up II',
            turnsRemaining: 1,
        });
        // r4: decrement→0 (expired), active fires → fresh application
        expect(result[3].activeSelfBuffs[0]).toMatchObject({
            buffName: 'Attack Up II',
            turnsRemaining: 2,
        });
    });

    it('active buff applied every round keeps duration refreshed (Grif scenario)', () => {
        // Active fires every round (no charge configured), buff lasts 2 turns
        // Buff should never drop below 2 on active rounds — always refreshed before snapshot
        const buff = makeBuff('Out. Damage Up III', { skillSource: 'active', skillDuration: 2 });
        const result = computeBuffTimeline([buff], [], 0, false, 5);
        // All rounds: active fires every round, decrement then refresh → always 2
        result.forEach((entry) => {
            expect(entry.activeSelfBuffs[0]).toMatchObject({
                buffName: 'Out. Damage Up III',
                turnsRemaining: 2,
            });
        });
    });

    it('startCharged=true fires charged on round 1', () => {
        const buff = makeBuff('Crit Power', { skillSource: 'charge', skillDuration: 1 });
        const result = computeBuffTimeline([buff], [], 2, true, 1);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Crit Power', turnsRemaining: 1 }]);
    });

    it('per-round accumulating buff starts at 0 and increments every round', () => {
        const buff = makeAccumBuff('Overload', 'per-round', { maxStacks: 10 });
        const result = computeBuffTimeline([buff], [], 2, false, 4);
        // Round 1: first increment → 1 stack
        expect(result[0].activeSelfBuffs[0]).toEqual({
            buffName: 'Overload',
            turnsRemaining: 'recurring',
            stacks: 1,
        });
        expect(result[1].activeSelfBuffs[0]).toEqual({
            buffName: 'Overload',
            turnsRemaining: 'recurring',
            stacks: 2,
        });
        expect(result[2].activeSelfBuffs[0]).toEqual({
            buffName: 'Overload',
            turnsRemaining: 'recurring',
            stacks: 3,
        });
        expect(result[3].activeSelfBuffs[0]).toEqual({
            buffName: 'Overload',
            turnsRemaining: 'recurring',
            stacks: 4,
        });
    });

    it('per-round accumulating buff is absent from snapshot until round 1', () => {
        // Confirm it doesn't appear at stacks=0 (before first increment)
        const buff = makeAccumBuff('Overload', 'per-round');
        const result = computeBuffTimeline([buff], [], 2, false, 3);
        // All 3 rounds should show stacks ≥ 1 (incremented before snapshot)
        result.forEach((entry, i) => {
            expect(entry.activeSelfBuffs[0].stacks).toBe(i + 1);
        });
    });

    it('per-round accumulating buff is capped at maxStacks', () => {
        const buff = makeAccumBuff('Overload', 'per-round', { maxStacks: 3 });
        const result = computeBuffTimeline([buff], [], 2, false, 5);
        expect(result[2].activeSelfBuffs[0].stacks).toBe(3);
        expect(result[3].activeSelfBuffs[0].stacks).toBe(3);
        expect(result[4].activeSelfBuffs[0].stacks).toBe(3);
    });

    it('per-active accumulating buff only increments on active rounds', () => {
        // chargeCount=2, startCharged=false: active r1,r2 then charged r3
        const buff = makeAccumBuff('Core Charge I', 'per-active', { maxStacks: 10 });
        const result = computeBuffTimeline([buff], [], 2, false, 4);
        expect(result[0].activeSelfBuffs[0].stacks).toBe(1); // r1: active
        expect(result[1].activeSelfBuffs[0].stacks).toBe(2); // r2: active
        expect(result[2].activeSelfBuffs[0].stacks).toBe(2); // r3: charged — no increment
        expect(result[3].activeSelfBuffs[0].stacks).toBe(3); // r4: active
    });

    it('per-charge accumulating buff only increments on charge rounds', () => {
        // chargeCount=2, startCharged=false: charged r3, r6
        const buff = makeAccumBuff('Blast', 'per-charge', { maxStacks: 10 });
        const result = computeBuffTimeline([buff], [], 2, false, 4);
        // r1,r2: active — no increment; r3: charged → 1; r4: active → still 1
        expect(result[0].activeSelfBuffs).toEqual([]); // 0 stacks → excluded from snapshot
        expect(result[1].activeSelfBuffs).toEqual([]);
        expect(result[2].activeSelfBuffs[0].stacks).toBe(1); // r3: charged
        expect(result[3].activeSelfBuffs[0].stacks).toBe(1); // r4: active, no increment
    });

    it('accumulating buff with rate > 1 increments by rate each trigger', () => {
        const buff = makeAccumBuff('Blast', 'per-round', { stacks: 2, maxStacks: 10 });
        const result = computeBuffTimeline([buff], [], 2, false, 3);
        expect(result[0].activeSelfBuffs[0].stacks).toBe(2);
        expect(result[1].activeSelfBuffs[0].stacks).toBe(4);
        expect(result[2].activeSelfBuffs[0].stacks).toBe(6);
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
