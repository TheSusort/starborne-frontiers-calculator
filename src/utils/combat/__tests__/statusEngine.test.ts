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

// The engine is now ACTION-FED: it no longer predicts the charge cadence. For the
// ported timeline tests, the harness plays the attacker's cadence (the old
// computeChargeSchedule logic) and notifies the engine via sourceFired each round.
// NOTE: this helper is a faithful COPY of the engine's charge-banking rule — if the
// banking rule in engine.ts changes, update this helper to match.
// Decrement lives in the owner's Post Turn (decrementSide): we snapshot then decrement
// BOTH sides at the end of the round — equivalent window to the old decrement-on-step
// (same-turn decrement rule).
const chargedRounds = (
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
): Set<number> => {
    const out = new Set<number>();
    if (chargeCount <= 0) return out;
    let charges = startCharged ? chargeCount : 0;
    for (let r = 1; r <= totalRounds; r++) {
        if (charges >= chargeCount) {
            out.add(r);
            charges = 0;
        } else {
            charges += 1;
        }
    }
    return out;
};

const runTimeline = (
    selfBuffs: SelectedGameBuff[],
    enemyDebuffs: SelectedGameBuff[],
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
) => {
    const eng = createStatusEngine({ selfBuffs, enemyDebuffs });
    const charged = chargedRounds(chargeCount, startCharged, totalRounds);
    return Array.from({ length: totalRounds }, (_, i) => {
        const r = i + 1;
        eng.beginRound(r);
        // The attacker fires its real slot this round; all scheduled buffs (self AND
        // legacy/merged enemy) ride the attacker's cadence (action-fed legacy rule).
        eng.sourceFired('attacker', charged.has(r) ? 'charge' : 'active', r);
        const entry = { round: r, ...eng.snapshot() };
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

    it('LEGACY RULE: enemy debuff ignores its source schedule and rides the attacker cadence', () => {
        // CHANGED by the action-fed legacy rule: sourceChargeCount/sourceStartCharged are
        // now IGNORED (superseded by real team turns in a later task). The team debuff rides
        // the ATTACKER's real cadence. Current ship: startCharged=true, chargeCount=2 →
        // charged on rounds 1,4. Concentrate Fire (skillSource 'active', 1t) fires only on
        // the attacker's ACTIVE rounds (2,3), NOT round 1.
        const concentrateFire = makeBuff('Concentrate Fire', {
            skillSource: 'active',
            skillDuration: 1,
            sourceChargeCount: 2,
            sourceStartCharged: false,
        });
        const result = runTimeline([], [concentrateFire], 2, true, 3);
        // Round 1: attacker fires CHARGE → active-sourced CF does NOT fire (was: fired, on Judge's schedule)
        expect(result[0].activeEnemyDebuffs).toEqual([]);
        // Round 2: attacker fires ACTIVE → CF fires
        expect(result[1].activeEnemyDebuffs).toEqual([
            { buffName: 'Concentrate Fire', turnsRemaining: 1 },
        ]);
        // Round 3: attacker fires ACTIVE → CF fires (re-applied after expiry)
        expect(result[2].activeEnemyDebuffs).toEqual([
            { buffName: 'Concentrate Fire', turnsRemaining: 1 },
        ]);
    });

    it('enemy debuff with no source schedule rides the attacker cadence', () => {
        // No sourceChargeCount/sourceStartCharged → always rode the current ship's cadence.
        // Current ship: startCharged=true, chargeCount=2 → Round 1 is charge.
        const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
        const result = runTimeline([], [debuff], 2, true, 1);
        // Round 1 is charge for the attacker → the active-sourced debuff does not fire
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

    it('throws when beginRound is called out of sequence', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // skipping round 2 → must throw with the expected-round message
        expect(() => eng.beginRound(3)).toThrow(/expected round 2/);
        // repeating a round → must throw with the expected-round message
        const eng2 = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng2.beginRound(1);
        expect(() => eng2.beginRound(1)).toThrow(/expected round 2/);
    });

    it('throws when sourceFired targets a round other than the current one', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        expect(() => eng.sourceFired('attacker', 'active', 2)).toThrow(/engine is at round 1/);
    });

    it('rejects applyTimedAbilityStatus before the first round (round 0)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
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
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const status: RegisteredAbilityStatus = {
            payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 30 } },
            side: 'self',
            sourceSlot: 'active',
            duration: 2,
            conditions: [],
            kind: 'timed',
        };
        eng.registerAbilityStatuses([status]);

        // Decrement now happens in the owner's Post Turn (decrementSide), not at round top.
        eng.beginRound(1);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(0);
        eng.decrementSide('self');

        eng.beginRound(2);
        eng.applyTimedAbilityStatus(2, status);
        expect(eng.timedAbilityStatuses('self').map((s) => s.payload.buffName)).toEqual([
            'Attack Up',
        ]);
        eng.decrementSide('self'); // 2 → 1

        eng.beginRound(3);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(1); // still within window
        eng.decrementSide('self'); // 1 → 0 → expired

        eng.beginRound(4);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(0); // expired
    });

    it('tier precedence: a lower-tier ability status does not displace an applied higher tier', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
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
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, tierTwo);
        eng.applyTimedAbilityStatus(1, tierOne); // same family, lower tier → ignored
        const active = eng.timedAbilityStatuses('self');
        expect(active.map((s) => s.payload.buffName)).toEqual(['Attack Up II']);
    });

    it('accumulating ability status stacks per-active and excludes from snapshot at 0', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const accum: RegisteredAbilityStatus = {
            payload: { buffName: 'Momentum', stacks: 1, parsedEffects: { critDamage: 10 } },
            side: 'self',
            sourceSlot: 'active',
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
        // Attacker fires active r1,r2; charged r3; active r4 (per-active ticks on active).
        eng.beginRound(1);
        eng.sourceFired('attacker', 'active', 1);
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(1);
        eng.beginRound(2);
        eng.sourceFired('attacker', 'active', 2);
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(2);
        eng.beginRound(3);
        eng.sourceFired('attacker', 'charge', 3); // charged → no increment
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(2);
        eng.beginRound(4);
        eng.sourceFired('attacker', 'active', 4);
        const r4 = eng.snapshot();
        expect(eng.activeAbilityStatuses('self', baseCtx)[0].active.stacks).toBe(3);
        // It must NOT leak into the scheduled snapshot (engine appends it separately).
        expect(r4.activeSelfBuffs).toEqual([]);
    });

    it('aura ability status is included only when its conditions pass', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const aura: RegisteredAbilityStatus = {
            payload: { buffName: 'Focus', stacks: 1, parsedEffects: { crit: 15 } },
            side: 'self',
            sourceSlot: 'passive',
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
        eng.beginRound(1);
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
        expect(eng.activeAbilityStatuses('self', ctx(0))).toHaveLength(0);
        expect(eng.activeAbilityStatuses('self', ctx(2))).toHaveLength(1);
    });
});

describe('landsTimedEnemyApplication hook (Task 7)', () => {
    it('default (no hook): every timed enemy upsert lands and resistedEnemy is empty', () => {
        const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [debuff] });
        eng.beginRound(1);
        const result = eng.sourceFired('attacker', 'active', 1);
        expect(result).toEqual({ resistedEnemy: [] });
        expect(eng.snapshot().activeEnemyDebuffs).toEqual([
            { buffName: 'Def Down', turnsRemaining: 2 },
        ]);
    });

    it('hook returning false skips the upsert and returns the buffName in resistedEnemy', () => {
        const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [debuff],
            landsTimedEnemyApplication: (b) => b.buffName !== 'Def Down',
        });
        eng.beginRound(1);
        const result = eng.sourceFired('attacker', 'active', 1);
        // The application was rejected → no status stored, buffName reported resisted.
        expect(result).toEqual({ resistedEnemy: ['Def Down'] });
        expect(eng.snapshot().activeEnemyDebuffs).toEqual([]);
    });

    it('hook gates per-buff: lands one timed enemy debuff while rejecting another', () => {
        const landed = makeBuff('Def Down', { skillSource: 'active', skillDuration: 2 });
        const rejected = makeBuff('Armor Break', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [landed, rejected],
            landsTimedEnemyApplication: (b) => b.buffName === 'Def Down',
        });
        eng.beginRound(1);
        const result = eng.sourceFired('attacker', 'active', 1);
        expect(result).toEqual({ resistedEnemy: ['Armor Break'] });
        expect(eng.snapshot().activeEnemyDebuffs).toEqual([
            { buffName: 'Def Down', turnsRemaining: 2 },
        ]);
    });

    it('a rejected re-application does NOT clear the existing in-window status (persistence)', () => {
        // Land on round 1 (hook true), then reject the round-2 re-application (hook false):
        // the round-1 status must persist its window, not be cleared by the rejected upsert.
        const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 3 });
        let lands = true;
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [debuff],
            landsTimedEnemyApplication: () => lands,
        });
        eng.beginRound(1);
        eng.sourceFired('attacker', 'active', 1); // lands → turnsRemaining 3
        expect(eng.snapshot().activeEnemyDebuffs).toEqual([
            { buffName: 'Def Down', turnsRemaining: 3 },
        ]);
        eng.decrementSide('enemy'); // 3 → 2

        lands = false;
        eng.beginRound(2);
        const r2 = eng.sourceFired('attacker', 'active', 2); // rejected → must NOT clear
        expect(r2).toEqual({ resistedEnemy: ['Def Down'] });
        // The round-1 status still in window (turnsRemaining 2).
        expect(eng.snapshot().activeEnemyDebuffs).toEqual([
            { buffName: 'Def Down', turnsRemaining: 2 },
        ]);
    });

    it('the hook does not gate self buffs — only timed enemy upserts', () => {
        const selfBuff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [selfBuff],
            enemyDebuffs: [],
            landsTimedEnemyApplication: () => false, // would reject everything if it applied to self
        });
        eng.beginRound(1);
        const result = eng.sourceFired('attacker', 'active', 1);
        expect(result).toEqual({ resistedEnemy: [] });
        expect(eng.snapshot().activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 2 }]);
    });
});

describe('decrementSide (owner Post-Turn decrement)', () => {
    it('decrements and expires a scheduled timed status, reporting its buffName', () => {
        // chargeCount=0 → every round is active. Self buff fires each active round, 2t.
        const buff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({ selfBuffs: [buff], enemyDebuffs: [] });
        // round 1: attacker fires active → applies Atk Up at 2 turns (NO decrement at round top).
        eng.beginRound(1);
        eng.sourceFired('attacker', 'active', 1);
        const r1 = eng.snapshot();
        expect(r1.activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 2 }]);
        // First owner Post-Turn: 2 → 1, not yet expired.
        expect(eng.decrementSide('self')).toEqual({ expired: [] });
        // Second decrement: 1 → 0 → expired, reports the stored buffName.
        expect(eng.decrementSide('self')).toEqual({ expired: ['Atk Up'] });
        // Already gone → empty.
        expect(eng.decrementSide('self')).toEqual({ expired: [] });
    });

    it('the round step no longer decrements: a 1t buff applied round 1 is still present round 2 without decrementSide', () => {
        const buff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const eng = createStatusEngine({ selfBuffs: [buff], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.sourceFired('attacker', 'active', 1);
        const r1 = eng.snapshot();
        expect(r1.activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        // No decrementSide between rounds → the buff must survive into round 2's snapshot
        // (re-applied this round too, but the point is beginRound/snapshot don't expire it).
        eng.beginRound(2);
        eng.sourceFired('attacker', 'active', 2);
        const r2 = eng.snapshot();
        expect(r2.activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
    });

    it('decrements each side independently', () => {
        const selfBuff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const enemyDebuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
        const eng = createStatusEngine({ selfBuffs: [selfBuff], enemyDebuffs: [enemyDebuff] });
        eng.beginRound(1);
        eng.sourceFired('attacker', 'active', 1);
        // Decrementing self does not touch the enemy map.
        expect(eng.decrementSide('self')).toEqual({ expired: ['Atk Up'] });
        expect(eng.decrementSide('enemy')).toEqual({ expired: ['Def Down'] });
    });

    it('decrements/expires a timed ability status and reports its expiry name', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        const status: RegisteredAbilityStatus = {
            payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 30 } },
            side: 'self',
            sourceSlot: 'active',
            duration: 2,
            conditions: [],
            kind: 'timed',
        };
        eng.registerAbilityStatuses([status]);
        eng.beginRound(1);
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

describe('sourceFired source-keyed scheduling (teamSources)', () => {
    it("a team source's timed self buff applies only when ITS id fires the matching slot", () => {
        const teamBuff = makeBuff('Team Atk Up', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            teamSources: [{ sourceId: 't1', selfBuffs: [teamBuff], enemyDebuffs: [] }],
        });
        eng.beginRound(1);
        // 'attacker' firing the matching slot must NOT apply the team source's buff.
        eng.sourceFired('attacker', 'active', 1);
        expect(eng.snapshot().activeSelfBuffs).toEqual([]);
        // The team source firing its matching slot applies it.
        eng.sourceFired('t1', 'active', 1);
        expect(eng.snapshot().activeSelfBuffs).toEqual([
            { buffName: 'Team Atk Up', turnsRemaining: 2 },
        ]);
    });

    it("a team source's timed enemy debuff only fires on ITS matching slot", () => {
        const teamDebuff = makeBuff('Team Def Down', { skillSource: 'charge', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            teamSources: [{ sourceId: 't1', selfBuffs: [], enemyDebuffs: [teamDebuff] }],
        });
        eng.beginRound(1);
        // Wrong slot (active) → no application.
        eng.sourceFired('t1', 'active', 1);
        expect(eng.snapshot().activeEnemyDebuffs).toEqual([]);
        // Matching slot (charge) → applied.
        eng.sourceFired('t1', 'charge', 1);
        expect(eng.snapshot().activeEnemyDebuffs).toEqual([
            { buffName: 'Team Def Down', turnsRemaining: 2 },
        ]);
    });

    it('an unregistered sourceId no-ops (no application, empty resisted)', () => {
        const teamBuff = makeBuff('Team Atk Up', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            teamSources: [{ sourceId: 't1', selfBuffs: [teamBuff], enemyDebuffs: [] }],
        });
        eng.beginRound(1);
        const result = eng.sourceFired('unknown-ship', 'active', 1);
        expect(result).toEqual({ resistedEnemy: [] });
        expect(eng.snapshot().activeSelfBuffs).toEqual([]);
    });

    it("the attacker's own timed buffs still apply on 'attacker' and not on a team id", () => {
        const attackerBuff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [attackerBuff],
            enemyDebuffs: [],
            teamSources: [{ sourceId: 't1', selfBuffs: [], enemyDebuffs: [] }],
        });
        eng.beginRound(1);
        // Team id firing must not apply the attacker's scheduled buff.
        eng.sourceFired('t1', 'active', 1);
        expect(eng.snapshot().activeSelfBuffs).toEqual([]);
        eng.sourceFired('attacker', 'active', 1);
        expect(eng.snapshot().activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 2 }]);
    });

    it("a team source's always-active buff joins the global always set (cadence-independent)", () => {
        const alwaysBuff = makeBuff('Aura', {}); // no skillSource/duration → always-active
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            teamSources: [{ sourceId: 't1', selfBuffs: [alwaysBuff], enemyDebuffs: [] }],
        });
        eng.beginRound(1);
        // No sourceFired needed — always-active buffs are in the snapshot from round top.
        expect(eng.snapshot().activeSelfBuffs).toEqual([
            { buffName: 'Aura', turnsRemaining: 'recurring' },
        ]);
    });
});
