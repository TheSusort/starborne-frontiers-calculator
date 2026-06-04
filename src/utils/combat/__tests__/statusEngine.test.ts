import { describe, it, expect } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { SelectedGameBuff } from '../../../types/calculator';
import { ConditionContext } from '../../abilities/evaluateConditions';

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

// Adapter so the ported expectations stay identical to the old computeBuffTimeline ones.
// Decrement now lives in the owner's Post Turn (decrementSide), not in step(): for the
// timeline parity we snapshot via step(r) then decrement BOTH sides at the end of the
// round — equivalent window to the old decrement-on-step (same-turn decrement rule).
const runTimeline = (
    selfBuffs: SelectedGameBuff[],
    enemyDebuffs: SelectedGameBuff[],
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
) => {
    const eng = createStatusEngine({
        selfBuffs,
        enemyDebuffs,
        chargeCount,
        startCharged,
        totalRounds,
    });
    return Array.from({ length: totalRounds }, (_, i) => {
        const entry = { round: i + 1, ...eng.step(i + 1) };
        eng.decrementSide('self');
        eng.decrementSide('enemy');
        return entry;
    });
};

describe('createStatusEngine (computeBuffTimeline parity)', () => {
    it('returns one entry per round with correct round numbers', () => {
        const result = runTimeline([], [], 2, false, 3);
        expect(result).toHaveLength(3);
        expect(result[0].round).toBe(1);
        expect(result[2].round).toBe(3);
    });

    it('no buffs → empty lists every round', () => {
        const result = runTimeline([], [], 2, false, 2);
        expect(result[0].activeSelfBuffs).toEqual([]);
        expect(result[0].activeEnemyDebuffs).toEqual([]);
    });

    it('always-active buff (no skillSource) appears every round as recurring', () => {
        const buff = makeBuff('Overload');
        const result = runTimeline([buff], [], 2, false, 3);
        result.forEach((entry) => {
            expect(entry.activeSelfBuffs).toEqual([
                { buffName: 'Overload', turnsRemaining: 'recurring' },
            ]);
        });
    });

    it('passive buff appears every round as recurring', () => {
        const buff = makeBuff('Passive Atk', { skillSource: 'passive1' });
        const result = runTimeline([buff], [], 2, false, 2);
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
        const result = runTimeline([buff], [], 2, false, 2);
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
        const result = runTimeline([buff], [], 2, false, 4);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        expect(result[1].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        expect(result[2].activeSelfBuffs).toEqual([]); // r3: charged, no active buff
        expect(result[3].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
    });

    it('charge buff applies on charge rounds only and decrements each round', () => {
        // chargeCount=2, startCharged=false: r3 and r6 are charged
        const buff = makeBuff('Crit Power', { skillSource: 'charge', skillDuration: 2 });
        const result = runTimeline([buff], [], 2, false, 6);
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
        const result = runTimeline([], [concentrateFire], 2, true, 3);
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
        const result = runTimeline([], [debuff], 2, true, 1);
        // Round 1 is charge for current ship, active debuff does not fire
        expect(result[0].activeEnemyDebuffs).toEqual([]);
    });

    it('enemy debuffs tracked separately', () => {
        const selfBuff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const enemyDebuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
        const result = runTimeline([selfBuff], [enemyDebuff], 2, false, 1);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        expect(result[0].activeEnemyDebuffs).toEqual([{ buffName: 'Def Down', turnsRemaining: 1 }]);
    });

    it('DoT tiers stack independently — Inferno I and Inferno II coexist', () => {
        // Both applied on active; they are separate entities, neither overwrites the other
        const infernoI = makeBuff('Inferno I', { skillSource: 'active', skillDuration: 2 });
        const infernoII = makeBuff('Inferno II', { skillSource: 'active', skillDuration: 2 });
        const result = runTimeline([], [infernoI, infernoII], 0, false, 1);
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
        const result = runTimeline([activeI, chargeIII], [], 2, false, 6);
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
        const result = runTimeline([buff], [], 2, false, 4);
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
        const result = runTimeline([buff], [], 0, false, 5);
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
        const result = runTimeline([buff], [], 2, true, 1);
        expect(result[0].activeSelfBuffs).toEqual([{ buffName: 'Crit Power', turnsRemaining: 1 }]);
    });

    it('per-round accumulating buff starts at 0 and increments every round', () => {
        const buff = makeAccumBuff('Overload', 'per-round', { maxStacks: 10 });
        const result = runTimeline([buff], [], 2, false, 4);
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

    it('per-round accumulating buff appears from round 1 with stacks tracking the round number', () => {
        // Confirm it doesn't appear at stacks=0 (before first increment)
        const buff = makeAccumBuff('Overload', 'per-round');
        const result = runTimeline([buff], [], 2, false, 3);
        // All 3 rounds should show stacks ≥ 1 (incremented before snapshot)
        result.forEach((entry, i) => {
            expect(entry.activeSelfBuffs[0].stacks).toBe(i + 1);
        });
    });

    it('per-round accumulating buff is capped at maxStacks', () => {
        const buff = makeAccumBuff('Overload', 'per-round', { maxStacks: 3 });
        const result = runTimeline([buff], [], 2, false, 5);
        expect(result[2].activeSelfBuffs[0].stacks).toBe(3);
        expect(result[3].activeSelfBuffs[0].stacks).toBe(3);
        expect(result[4].activeSelfBuffs[0].stacks).toBe(3);
    });

    it('per-active accumulating buff only increments on active rounds', () => {
        // chargeCount=2, startCharged=false: active r1,r2 then charged r3
        const buff = makeAccumBuff('Core Charge I', 'per-active', { maxStacks: 10 });
        const result = runTimeline([buff], [], 2, false, 4);
        expect(result[0].activeSelfBuffs[0].stacks).toBe(1); // r1: active
        expect(result[1].activeSelfBuffs[0].stacks).toBe(2); // r2: active
        expect(result[2].activeSelfBuffs[0].stacks).toBe(2); // r3: charged — no increment
        expect(result[3].activeSelfBuffs[0].stacks).toBe(3); // r4: active
    });

    it('per-charge accumulating buff only increments on charge rounds', () => {
        // chargeCount=2, startCharged=false: charged r3, r6
        const buff = makeAccumBuff('Blast', 'per-charge', { maxStacks: 10 });
        const result = runTimeline([buff], [], 2, false, 4);
        // r1,r2: active — no increment; r3: charged → 1; r4: active → still 1
        expect(result[0].activeSelfBuffs).toEqual([]); // 0 stacks → excluded from snapshot
        expect(result[1].activeSelfBuffs).toEqual([]);
        expect(result[2].activeSelfBuffs[0].stacks).toBe(1); // r3: charged
        expect(result[3].activeSelfBuffs[0].stacks).toBe(1); // r4: active, no increment
    });

    it('accumulating buff with rate > 1 increments by rate each trigger', () => {
        const buff = makeAccumBuff('Blast', 'per-round', { stacks: 2, maxStacks: 10 });
        const result = runTimeline([buff], [], 2, false, 3);
        expect(result[0].activeSelfBuffs[0].stacks).toBe(2);
        expect(result[1].activeSelfBuffs[0].stacks).toBe(4);
        expect(result[2].activeSelfBuffs[0].stacks).toBe(6);
    });

    it('deduplicates always-active buffs with the same buffName', () => {
        const buff1 = makeBuff('Overload');
        const buff2 = makeBuff('Overload'); // same name, different instance
        const result = runTimeline([buff1, buff2], [], 2, false, 2);
        expect(result[0].activeSelfBuffs).toHaveLength(1);
        expect(result[0].activeSelfBuffs[0]).toEqual({
            buffName: 'Overload',
            turnsRemaining: 'recurring',
        });
    });

    it('throws when step is called out of sequence', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 2,
            startCharged: false,
            totalRounds: 3,
        });
        expect(eng.step(1)).toBeDefined();
        // skipping round 2 → must throw with the expected-round message
        expect(() => eng.step(3)).toThrow(/expected round 2/);
        // repeating a round → must throw with the expected-round message
        const eng2 = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 2,
            startCharged: false,
            totalRounds: 3,
        });
        eng2.step(1);
        expect(() => eng2.step(1)).toThrow(/expected round 2/);
    });

    it('throws when step is called beyond totalRounds', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 2,
            startCharged: false,
            totalRounds: 2,
        });
        eng.step(1);
        eng.step(2);
        // The charge schedule was computed for 2 rounds — round 3 must fail loudly.
        expect(() => eng.step(3)).toThrow(/beyond totalRounds 2/);
    });

    it('rejects applyTimedAbilityStatus before the first step (round 0)', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 2,
        });
        const status = {
            payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 10 } },
            side: 'self' as const,
            sourceSlot: 'active' as const,
            duration: 2,
            conditions: [],
            kind: 'timed' as const,
        };
        // lastRound starts at 0 — the equality check alone would accept round 0.
        expect(() => eng.applyTimedAbilityStatus(0, status)).toThrow(/rounds are 1-based/);
    });
});

describe('createStatusEngine — ability statuses (Task 6)', () => {
    it('timed ability status applied round 2 (duration 2) is visible rounds 2-3, gone round 4', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 5,
        });
        const status: RegisteredAbilityStatus = {
            payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 30 } },
            side: 'self',
            sourceSlot: 'active',
            duration: 2,
            conditions: [],
            kind: 'timed',
        };
        eng.registerAbilityStatuses([status]);

        // Decrement now happens in the owner's Post Turn (decrementSide), not step().
        eng.step(1);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(0);
        eng.decrementSide('self');

        eng.step(2);
        eng.applyTimedAbilityStatus(2, status);
        expect(eng.timedAbilityStatuses('self').map((s) => s.payload.buffName)).toEqual([
            'Attack Up',
        ]);
        eng.decrementSide('self'); // 2 → 1

        eng.step(3);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(1); // still within window
        eng.decrementSide('self'); // 1 → 0 → expired

        eng.step(4);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(0); // expired
    });

    it('tier precedence: a lower-tier ability status does not displace an applied higher tier', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 3,
        });
        const tierTwo: RegisteredAbilityStatus = {
            payload: { buffName: 'Attack Up II', stacks: 1, parsedEffects: { attack: 40 } },
            side: 'self',
            sourceSlot: 'active',
            duration: 3,
            conditions: [],
            kind: 'timed',
        };
        const tierOne: RegisteredAbilityStatus = {
            payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 30 } },
            side: 'self',
            sourceSlot: 'active',
            duration: 3,
            conditions: [],
            kind: 'timed',
        };
        eng.registerAbilityStatuses([tierTwo, tierOne]);
        eng.step(1);
        eng.applyTimedAbilityStatus(1, tierTwo);
        eng.applyTimedAbilityStatus(1, tierOne); // same family, lower tier → ignored
        const active = eng.timedAbilityStatuses('self');
        expect(active.map((s) => s.payload.buffName)).toEqual(['Attack Up II']);
    });

    it('accumulating ability status stacks per-active and excludes from snapshot at 0', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 2,
            startCharged: false,
            totalRounds: 4,
        });
        const accum: RegisteredAbilityStatus = {
            payload: { buffName: 'Momentum', stacks: 1, parsedEffects: { critDamage: 10 } },
            side: 'self',
            sourceSlot: 'active',
            duration: 'recurring',
            conditions: [],
            kind: 'accumulating',
            maxStacks: 5,
            stackTrigger: 'per-active',
        };
        eng.registerAbilityStatuses([accum]);
        const baseCtx: ConditionContext = {
            selfBuffNames: [],
            selfDebuffNames: [],
            enemyBuffNames: [],
            enemyDebuffCount: 0,
            effectiveCritRate: 50,
            adjacentAllyCount: 0,
            enemyAdjacentCount: 0,
            enemyDestroyedCount: 0,
            selfHpPct: 100,
            enemyHpPct: 100,
        };
        // chargeCount=2, startCharged=false → active r1,r2, charged r3, active r4
        eng.step(1);
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(1);
        eng.step(2);
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(2);
        eng.step(3); // charged → no increment
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(2);
        const r4 = eng.step(4);
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(3);
        // It must NOT leak into the scheduled snapshot (engine appends it separately).
        expect(r4.activeSelfBuffs).toEqual([]);
    });

    it('aura ability status is included only when its conditions pass', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 2,
        });
        const aura: RegisteredAbilityStatus = {
            payload: { buffName: 'Focus', stacks: 1, parsedEffects: { crit: 15 } },
            side: 'self',
            sourceSlot: 'passive',
            duration: 'recurring',
            conditions: [
                {
                    subject: 'enemy-debuff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 1,
                },
            ],
            kind: 'aura',
        };
        eng.registerAbilityStatuses([aura]);
        const ctx = (debuffCount: number): ConditionContext => ({
            selfBuffNames: [],
            selfDebuffNames: [],
            enemyBuffNames: [],
            enemyDebuffCount: debuffCount,
            effectiveCritRate: 50,
            adjacentAllyCount: 0,
            enemyAdjacentCount: 0,
            enemyDestroyedCount: 0,
            selfHpPct: 100,
            enemyHpPct: 100,
        });
        eng.step(1);
        expect(eng.activeAbilityStatuses('self', ctx(0))).toHaveLength(0);
        expect(eng.activeAbilityStatuses('self', ctx(2))).toHaveLength(1);
    });
});

describe('decrementSide (owner Post-Turn decrement)', () => {
    it('decrements and expires a scheduled timed status, reporting its buffName', () => {
        // chargeCount=0 → every round is active. Self buff fires each active round, 2t.
        const buff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [buff],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 1,
        });
        // step(1) applies Atk Up at 2 turns (NO decrement in step).
        const r1 = eng.step(1);
        expect(r1.activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 2 }]);
        // First owner Post-Turn: 2 → 1, not yet expired.
        expect(eng.decrementSide('self')).toEqual({ expired: [] });
        // Second decrement: 1 → 0 → expired, reports the stored buffName.
        expect(eng.decrementSide('self')).toEqual({ expired: ['Atk Up'] });
        // Already gone → empty.
        expect(eng.decrementSide('self')).toEqual({ expired: [] });
    });

    it('step no longer decrements: a 1t buff applied round 1 is still present round 2 without decrementSide', () => {
        const buff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const eng = createStatusEngine({
            selfBuffs: [buff],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 2,
        });
        const r1 = eng.step(1);
        expect(r1.activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        // No decrementSide between rounds → the buff must survive into round 2's snapshot
        // (re-applied this round too, but the point is step() itself does not expire it).
        const r2 = eng.step(2);
        expect(r2.activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
    });

    it('decrements each side independently', () => {
        const selfBuff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const enemyDebuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
        const eng = createStatusEngine({
            selfBuffs: [selfBuff],
            enemyDebuffs: [enemyDebuff],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 1,
        });
        eng.step(1);
        // Decrementing self does not touch the enemy map.
        expect(eng.decrementSide('self')).toEqual({ expired: ['Atk Up'] });
        expect(eng.decrementSide('enemy')).toEqual({ expired: ['Def Down'] });
    });

    it('decrements/expires a timed ability status and reports its expiry name', () => {
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            chargeCount: 0,
            startCharged: false,
            totalRounds: 1,
        });
        const status: RegisteredAbilityStatus = {
            payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 30 } },
            side: 'self',
            sourceSlot: 'active',
            duration: 2,
            conditions: [],
            kind: 'timed',
        };
        eng.registerAbilityStatuses([status]);
        eng.step(1);
        eng.applyTimedAbilityStatus(1, status);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(1);
        // 2 → 1
        expect(eng.decrementSide('self')).toEqual({ expired: [] });
        expect(eng.timedAbilityStatuses('self')).toHaveLength(1);
        // 1 → 0 → expired, name reported.
        expect(eng.decrementSide('self')).toEqual({ expired: ['Attack Up'] });
        expect(eng.timedAbilityStatuses('self')).toHaveLength(0);
    });
});
