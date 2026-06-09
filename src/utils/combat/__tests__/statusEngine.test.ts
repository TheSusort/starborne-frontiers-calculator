import { describe, it, expect, vi } from 'vitest';
import { createStatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { SelectedGameBuff } from '../../../types/calculator';
import { ConditionContext } from '../../abilities/evaluateConditions';

// Inject a name into UNREMOVABLE_STATUSES so the name-set branch of clearRemovable is
// exercised against real engine logic (the shipped set is empty). CHEAT_DEATH_BUFFS is
// kept real. No existing test applies a buff named 'Immune Status', so this is inert
// everywhere except the dedicated clearRemovable case below.
vi.mock('../cheatDeathBuffs', () => ({
    CHEAT_DEATH_BUFFS: new Set(['Cheat Death']),
    UNREMOVABLE_STATUSES: new Set(['Immune Status']),
}));

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
// Decrement lives in the owner's Post Turn (decrementPlayer/decrementEnemy): we snapshot
// then decrement BOTH sides at the end of the round — equivalent window to the old
// decrement-on-step (same-turn decrement rule).
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
        eng.decrementPlayer('attacker');
        eng.decrementEnemy();
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

        // Decrement now happens in the owner's Post Turn (decrementPlayer), not at round top.
        eng.beginRound(1);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(0);
        eng.decrementPlayer('attacker');

        eng.beginRound(2);
        eng.applyTimedAbilityStatus(2, status);
        expect(eng.timedAbilityStatuses('self').map((s) => s.payload.buffName)).toEqual([
            'Attack Up',
        ]);
        eng.decrementPlayer('attacker'); // 2 → 1

        eng.beginRound(3);
        expect(eng.timedAbilityStatuses('self')).toHaveLength(1); // still within window
        eng.decrementPlayer('attacker'); // 1 → 0 → expired

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
        expect(eng.activeAbilityStatuses('self', () => baseCtx)[0].active.stacks).toBe(1);
        eng.beginRound(2);
        eng.sourceFired('attacker', 'active', 2);
        expect(eng.activeAbilityStatuses('self', () => baseCtx)[0].active.stacks).toBe(2);
        eng.beginRound(3);
        eng.sourceFired('attacker', 'charge', 3); // charged → no increment
        expect(eng.activeAbilityStatuses('self', () => baseCtx)[0].active.stacks).toBe(2);
        eng.beginRound(4);
        eng.sourceFired('attacker', 'active', 4);
        const r4 = eng.snapshot();
        expect(eng.activeAbilityStatuses('self', () => baseCtx)[0].active.stacks).toBe(3);
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
        expect(eng.activeAbilityStatuses('self', () => ctx(0))).toHaveLength(0);
        expect(eng.activeAbilityStatuses('self', () => ctx(2))).toHaveLength(1);
    });
});

describe('same-family overwrite rule (game-verified 2026-06-04)', () => {
    // Rule: a new application within a buff family (name minus the I/II/III tier suffix)
    // wins only if (a) its tier is higher, or (b) same tier AND its duration > the existing
    // entry's remaining turns. Otherwise it is blocked and the existing entry persists.
    //
    // Exercised on BOTH upsert sites: scheduled buffs (sourceFired → upsertBuff) and the
    // attacker's own timed ability statuses (applyTimedAbilityStatus).

    const timedAbility = (
        buffName: string,
        duration: number,
        attack: number
    ): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        payload: { buffName, stacks: 1, parsedEffects: { attack } },
        side: 'self',
        sourceSlot: 'active',
        duration,
        conditions: [],
        kind: 'timed',
    });

    describe('scheduled sourceFired path (upsertBuff)', () => {
        it('equal tier, existing remaining >= new duration → BLOCKED (existing untouched)', () => {
            // Team source applies Attack Up III (dur 3) on round 1. Then the attacker source
            // applies its own Attack Up III (dur 1) the same round. 1 <= 3 remaining → blocked.
            const teamBuff = makeBuff('Attack Up III', { skillSource: 'active', skillDuration: 3 });
            const attackerBuff = makeBuff('Attack Up III', {
                skillSource: 'active',
                skillDuration: 1,
            });
            const eng = createStatusEngine({
                selfBuffs: [attackerBuff],
                enemyDebuffs: [],
                teamSources: [{ sourceId: 't1', selfBuffs: [teamBuff], enemyDebuffs: [] }],
            });
            eng.beginRound(1);
            eng.sourceFired('t1', 'active', 1); // applies dur 3
            eng.sourceFired('attacker', 'active', 1); // dur 1, equal tier, 1 <= 3 → blocked
            // Single entry retaining the team buff's window — NOT clobbered to 1.
            expect(eng.snapshot().activeSelfBuffs).toEqual([
                { buffName: 'Attack Up III', turnsRemaining: 3 },
            ]);
        });

        it('equal tier, new duration > remaining → OVERWRITES (refresh)', () => {
            // A 2-turn buff re-applied next round has 1 remaining → 2 > 1 → refreshes.
            const buff = makeBuff('Attack Up II', { skillSource: 'active', skillDuration: 2 });
            const eng = createStatusEngine({ selfBuffs: [buff], enemyDebuffs: [] });
            eng.beginRound(1);
            eng.sourceFired('attacker', 'active', 1);
            expect(eng.snapshot().activeSelfBuffs).toEqual([
                { buffName: 'Attack Up II', turnsRemaining: 2 },
            ]);
            eng.decrementPlayer('attacker'); // 2 → 1
            eng.beginRound(2);
            eng.sourceFired('attacker', 'active', 2); // 2 > 1 remaining → refresh
            expect(eng.snapshot().activeSelfBuffs).toEqual([
                { buffName: 'Attack Up II', turnsRemaining: 2 },
            ]);
        });

        it('higher tier → OVERWRITES regardless of remaining', () => {
            const tierII = makeBuff('Attack Up II', { skillSource: 'active', skillDuration: 5 });
            const tierIII = makeBuff('Attack Up III', { skillSource: 'active', skillDuration: 1 });
            const eng = createStatusEngine({
                selfBuffs: [tierIII],
                enemyDebuffs: [],
                teamSources: [{ sourceId: 't1', selfBuffs: [tierII], enemyDebuffs: [] }],
            });
            eng.beginRound(1);
            eng.sourceFired('t1', 'active', 1); // Attack Up II, dur 5
            eng.sourceFired('attacker', 'active', 1); // Attack Up III, dur 1 — higher tier wins
            expect(eng.snapshot().activeSelfBuffs).toEqual([
                { buffName: 'Attack Up III', turnsRemaining: 1 },
            ]);
        });

        it('lower tier → BLOCKED (existing higher tier stays)', () => {
            const tierIII = makeBuff('Attack Up III', { skillSource: 'active', skillDuration: 2 });
            const tierI = makeBuff('Attack Up I', { skillSource: 'active', skillDuration: 5 });
            const eng = createStatusEngine({
                selfBuffs: [tierI],
                enemyDebuffs: [],
                teamSources: [{ sourceId: 't1', selfBuffs: [tierIII], enemyDebuffs: [] }],
            });
            eng.beginRound(1);
            eng.sourceFired('t1', 'active', 1); // Attack Up III, dur 2
            eng.sourceFired('attacker', 'active', 1); // Attack Up I, dur 5 — lower tier, blocked
            expect(eng.snapshot().activeSelfBuffs).toEqual([
                { buffName: 'Attack Up III', turnsRemaining: 2 },
            ]);
        });
    });

    describe('applyTimedAbilityStatus path', () => {
        it('equal tier, existing remaining >= new duration → BLOCKED (existing payload/identity untouched)', () => {
            const longer = timedAbility('Attack Up III', 3, 50);
            const shorter = timedAbility('Attack Up III', 1, 30);
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([longer, shorter]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, longer); // dur 3
            eng.applyTimedAbilityStatus(1, shorter); // dur 1, equal tier, 1 <= 3 → blocked
            const active = eng.timedAbilityStatuses('self');
            expect(active).toHaveLength(1);
            // Identity + payload of the longer (existing) status preserved.
            expect(active[0].active).toEqual({ buffName: 'Attack Up III', turnsRemaining: 3 });
            expect(active[0].payload.parsedEffects).toEqual({ attack: 50 });
        });

        it('equal tier, new duration > remaining → OVERWRITES (refresh)', () => {
            const status = timedAbility('Attack Up II', 2, 40);
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([status]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, status);
            eng.decrementPlayer('attacker'); // 2 → 1
            eng.beginRound(2);
            eng.applyTimedAbilityStatus(2, status); // 2 > 1 remaining → refresh
            expect(eng.timedAbilityStatuses('self')[0].active).toEqual({
                buffName: 'Attack Up II',
                turnsRemaining: 2,
            });
        });

        it('higher tier → OVERWRITES regardless of remaining', () => {
            const tierII = timedAbility('Attack Up II', 5, 40);
            const tierIII = timedAbility('Attack Up III', 1, 50);
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([tierII, tierIII]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, tierII); // dur 5
            eng.applyTimedAbilityStatus(1, tierIII); // higher tier, dur 1 → wins
            const active = eng.timedAbilityStatuses('self');
            expect(active).toHaveLength(1);
            expect(active[0].active).toEqual({ buffName: 'Attack Up III', turnsRemaining: 1 });
        });

        it('lower tier → BLOCKED (existing higher tier stays)', () => {
            const tierIII = timedAbility('Attack Up III', 2, 50);
            const tierI = timedAbility('Attack Up', 5, 30);
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([tierIII, tierI]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, tierIII); // dur 2
            eng.applyTimedAbilityStatus(1, tierI); // lower tier, dur 5 → blocked
            const active = eng.timedAbilityStatuses('self');
            expect(active).toHaveLength(1);
            expect(active[0].active).toEqual({ buffName: 'Attack Up III', turnsRemaining: 2 });
        });
    });
});

describe('landsTimedEnemyApplication hook (Task 7)', () => {
    it('default (no hook): every timed enemy upsert lands and resistedEnemy is empty, appliedEnemy has the name', () => {
        const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [debuff] });
        eng.beginRound(1);
        const result = eng.sourceFired('attacker', 'active', 1);
        expect(result).toEqual({ resistedEnemy: [], appliedEnemy: ['Def Down'] });
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
        expect(result).toEqual({ resistedEnemy: ['Def Down'], appliedEnemy: [] });
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
        expect(result).toEqual({ resistedEnemy: ['Armor Break'], appliedEnemy: ['Def Down'] });
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
        eng.decrementEnemy(); // 3 → 2

        lands = false;
        eng.beginRound(2);
        const r2 = eng.sourceFired('attacker', 'active', 2); // rejected → must NOT clear
        expect(r2).toEqual({ resistedEnemy: ['Def Down'], appliedEnemy: [] });
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
        expect(result).toEqual({ resistedEnemy: [], appliedEnemy: [] });
        expect(eng.snapshot().activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 2 }]);
    });
});

describe('decrementPlayer / decrementEnemy (owner Post-Turn decrement)', () => {
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
        expect(eng.decrementPlayer('attacker')).toEqual({ expired: [] });
        // Second decrement: 1 → 0 → expired, reports the stored buffName.
        expect(eng.decrementPlayer('attacker')).toEqual({ expired: ['Atk Up'] });
        // Already gone → empty.
        expect(eng.decrementPlayer('attacker')).toEqual({ expired: [] });
    });

    it('the round step no longer decrements: a 1t buff applied round 1 is still present round 2 without decrementPlayer', () => {
        const buff = makeBuff('Atk Up', { skillSource: 'active', skillDuration: 1 });
        const eng = createStatusEngine({ selfBuffs: [buff], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.sourceFired('attacker', 'active', 1);
        const r1 = eng.snapshot();
        expect(r1.activeSelfBuffs).toEqual([{ buffName: 'Atk Up', turnsRemaining: 1 }]);
        // No decrementPlayer between rounds → the buff must survive into round 2's snapshot
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
        // Decrementing the attacker does not touch the enemy map.
        expect(eng.decrementPlayer('attacker')).toEqual({ expired: ['Atk Up'] });
        expect(eng.decrementEnemy()).toEqual({ expired: ['Def Down'] });
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
        expect(eng.decrementPlayer('attacker')).toEqual({ expired: [] });
        expect(eng.timedAbilityStatuses('self')).toHaveLength(1);
        // 1 → 0 → expired, name reported.
        expect(eng.decrementPlayer('attacker')).toEqual({ expired: ['Attack Up'] });
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

    it('an unregistered sourceId no-ops (no application, empty resisted and appliedEnemy)', () => {
        const teamBuff = makeBuff('Team Atk Up', { skillSource: 'active', skillDuration: 2 });
        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [],
            teamSources: [{ sourceId: 't1', selfBuffs: [teamBuff], enemyDebuffs: [] }],
        });
        eng.beginRound(1);
        const result = eng.sourceFired('unknown-ship', 'active', 1);
        expect(result).toEqual({ resistedEnemy: [], appliedEnemy: [] });
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

describe('createStatusEngine — persistent stacking statuses (game-verified 2026-06-05)', () => {
    // A timed-shaped ability status whose buffName is a PERSISTENT_STACKING_BUFFS name.
    // The text duration (2 here) MUST be ignored — the name routes it to the persistent map.
    const persistentDebuff = (stacks = 1): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        payload: {
            buffName: 'Defense Shred',
            stacks,
            parsedEffects: { defense: -2 },
            application: 'inflict',
        },
        side: 'enemy',
        sourceSlot: 'active',
        duration: 2, // text duration — must be IGNORED for persistent names
        conditions: [],
        kind: 'timed',
    });

    it('three applications of a persistent debuff accumulate to 3 stacks', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        for (let r = 1; r <= 3; r++) {
            eng.beginRound(r);
            eng.applyTimedAbilityStatus(r, persistentDebuff());
        }
        const shred = eng
            .timedAbilityStatuses('enemy')
            .find((s) => s.active.buffName === 'Defense Shred');
        expect(shred).toBeDefined();
        expect(shred!.active.stacks).toBe(3);
        // Folded payload carries the stack count so effect × stacks folds downstream.
        expect(shred!.payload.stacks).toBe(3);
        // Sentinel marks it as no-expiry/no-re-roll.
        expect(shred!.active.turnsRemaining).toBe('permanent');
    });

    it('respects the buff DB max stack cap (Defense Shred → 20)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        for (let r = 1; r <= 22; r++) {
            eng.beginRound(r);
            eng.applyTimedAbilityStatus(r, persistentDebuff());
        }
        const shred = eng
            .timedAbilityStatuses('enemy')
            .find((s) => s.active.buffName === 'Defense Shred');
        expect(shred!.active.stacks).toBe(20);
    });

    it('persistent entry survives decrementEnemy across rounds and never expires', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, persistentDebuff());
        for (let r = 2; r <= 6; r++) {
            const { expired } = eng.decrementEnemy();
            expect(expired).toEqual([]);
            eng.beginRound(r);
        }
        const shred = eng
            .timedAbilityStatuses('enemy')
            .find((s) => s.active.buffName === 'Defense Shred');
        expect(shred).toBeDefined();
        expect(shred!.active.stacks).toBe(1);
    });

    it('scheduled path (upsertBuff via sourceFired) climbs stacks per application round', () => {
        // A scheduled (non-payload) enemy debuff whose name is persistent. skillDuration is the
        // text value and must be ignored; skillSource 'active' so it fires each active round.
        const scheduled = makeBuff('Defense Shred', {
            skillSource: 'active',
            skillDuration: 3,
            parsedEffects: { defense: -2 },
            stacks: 1,
        });
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [scheduled] });
        const stacksAt: number[] = [];
        for (let r = 1; r <= 3; r++) {
            eng.beginRound(r);
            eng.sourceFired('attacker', 'active', r);
            const snap = eng
                .snapshot()
                .activeEnemyDebuffs.find((b) => b.buffName === 'Defense Shred');
            stacksAt.push(snap?.stacks ?? 0);
            eng.decrementEnemy();
        }
        expect(stacksAt).toEqual([1, 2, 3]);
        // Scheduled persistent entries carry the no-re-roll sentinel.
        eng.beginRound(4);
        eng.sourceFired('attacker', 'active', 4);
        const snap = eng.snapshot().activeEnemyDebuffs.find((b) => b.buffName === 'Defense Shred');
        expect(snap?.turnsRemaining).toBe('permanent');
    });

    it('scheduled persistent entry persists with no buff-expired across rounds', () => {
        const scheduled = makeBuff('Defense Shred', {
            skillSource: 'active',
            skillDuration: 3,
            parsedEffects: { defense: -2 },
            stacks: 1,
        });
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [scheduled] });
        eng.beginRound(1);
        eng.sourceFired('attacker', 'active', 1);
        for (let r = 2; r <= 6; r++) {
            const { expired } = eng.decrementEnemy();
            expect(expired).toEqual([]);
            eng.beginRound(r);
        }
        const snap = eng.snapshot().activeEnemyDebuffs.find((b) => b.buffName === 'Defense Shred');
        expect(snap).toBeDefined();
    });
});

// Helper for the per-actor player-side tests. Returns a timed self-side
// RegisteredAbilityStatus with empty conditions and a trivial parsedEffects.
function timedSelfStatus(
    buffName: string,
    duration: number
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName, stacks: 1, parsedEffects: {} },
    };
}

describe('per-actor player sides', () => {
    it('keeps owners isolated: a timed buff applied to team-1 is not in the attacker snapshot', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedSelfStatus('Attack Up', 2), 'team-1');
        // team-1's timed buff is visible under team-1
        expect(se.timedAbilityStatuses('self', 'team-1').map((b) => b.payload.buffName)).toEqual([
            'Attack Up',
        ]);
        // attacker sees nothing
        expect(se.timedAbilityStatuses('self', 'attacker')).toEqual([]);
    });

    it('decrements per carrier: team-1 post-turn does not age attacker buffs', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedSelfStatus('Attack Up', 1), 'attacker');
        // Decrementing team-1 (empty owner) must not expire the attacker's buff
        expect(se.decrementPlayer('team-1').expired).toEqual([]);
        expect(se.timedAbilityStatuses('self', 'attacker')).toHaveLength(1);
        // Decrementing attacker expires the 1-turn buff
        expect(se.decrementPlayer('attacker').expired).toEqual(['Attack Up']);
    });

    it('accumulating ability status registered under team-1 is isolated from attacker', () => {
        // Register an ACCUMULATING ability status under 'team-1'. After two beginRounds
        // (per-round stackTrigger), activeAbilityStatuses('self', ctx, 'team-1') must show
        // stacks; ('self', ctx, 'attacker') must return nothing for this buff.
        const accumStatus: RegisteredAbilityStatus = {
            kind: 'accumulating',
            side: 'self',
            sourceSlot: 'passive',
            conditions: [],
            stackTrigger: 'per-round',
            maxStacks: 10,
            payload: { buffName: 'TeamMomentum', stacks: 1, parsedEffects: { attack: 5 } },
        };
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
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        // Register under 'team-1' — must NOT bleed into the 'attacker' owner's map.
        se.registerAbilityStatuses([accumStatus], 'team-1');
        // Round 1: per-round increment fires
        se.beginRound(1);
        // Round 2: second per-round increment fires
        se.beginRound(2);
        // team-1 sees 2 stacks (incremented twice by beginRound)
        const team1Active = se.activeAbilityStatuses('self', () => baseCtx, 'team-1');
        expect(team1Active).toHaveLength(1);
        expect(team1Active[0].active.stacks).toBe(2);
        expect(team1Active[0].payload.buffName).toBe('TeamMomentum');
        // attacker sees nothing for this buff — store isolation upheld
        const attackerActive = se.activeAbilityStatuses('self', () => baseCtx, 'attacker');
        expect(attackerActive.find((s) => s.payload.buffName === 'TeamMomentum')).toBeUndefined();
    });

    it('aura ability status registered under team-1 is isolated from attacker', () => {
        // Register an AURA ability status under 'team-1'. activeAbilityStatuses('self', ctx,
        // 'team-1') must include it; ('self', ctx, 'attacker') must not.
        const auraStatus: RegisteredAbilityStatus = {
            kind: 'aura',
            side: 'self',
            sourceSlot: 'passive',
            conditions: [], // unconditional — always passes
            payload: { buffName: 'TeamAura', stacks: 1, parsedEffects: { defense: 10 } },
        };
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
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        // Register under 'team-1' — must NOT bleed into the 'attacker' aura list.
        se.registerAbilityStatuses([auraStatus], 'team-1');
        se.beginRound(1);
        // team-1 sees the aura
        const team1Active = se.activeAbilityStatuses('self', () => baseCtx, 'team-1');
        expect(team1Active).toHaveLength(1);
        expect(team1Active[0].payload.buffName).toBe('TeamAura');
        expect(team1Active[0].active.turnsRemaining).toBe('recurring');
        // attacker sees nothing — aura store isolation upheld
        const attackerActive = se.activeAbilityStatuses('self', () => baseCtx, 'attacker');
        expect(attackerActive.find((s) => s.payload.buffName === 'TeamAura')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Per-target debuff stores (Task 1 — Phase 4a)
// ---------------------------------------------------------------------------
// The enemy-debuff side is now keyed by target actor id. The default enemy
// target id (used when no targetId is supplied) produces byte-identical
// behaviour to the pre-Task-1 singular store. A second target id ('tank')
// gets an isolated store.
// ---------------------------------------------------------------------------

describe('per-target debuff stores (Task 1)', () => {
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

    // Helpers for making timed enemy-side RegisteredAbilityStatus objects.
    function timedEnemyStatus(
        buffName: string,
        duration: number
    ): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
        return {
            kind: 'timed',
            side: 'enemy',
            sourceSlot: 'active',
            conditions: [],
            duration,
            payload: { buffName, stacks: 1, parsedEffects: { defense: -10 } },
        };
    }

    describe('default enemy target — byte-identical to the singular store', () => {
        it('a scheduled timed enemy debuff appears in snapshot().activeEnemyDebuffs', () => {
            const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 2 });
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [debuff] });
            eng.beginRound(1);
            eng.sourceFired('attacker', 'active', 1);
            expect(eng.snapshot().activeEnemyDebuffs).toEqual([
                { buffName: 'Def Down', turnsRemaining: 2 },
            ]);
        });

        it('decrementEnemy() with no argument decrements the default target and reports expiry', () => {
            const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 1 });
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [debuff] });
            eng.beginRound(1);
            eng.sourceFired('attacker', 'active', 1);
            expect(eng.snapshot().activeEnemyDebuffs).toHaveLength(1);
            const { expired } = eng.decrementEnemy();
            expect(expired).toEqual(['Def Down']);
            expect(eng.snapshot().activeEnemyDebuffs).toHaveLength(0);
        });

        it('applyTimedAbilityStatus enemy side goes to the default target store by default', () => {
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            const status = timedEnemyStatus('Armor Break', 2);
            eng.registerAbilityStatuses([status]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, status);
            // Visible in timedAbilityStatuses without specifying a targetId.
            // (Ability-sourced timed statuses carry a payload and are excluded from snapshot() —
            //  the engine appends them via timedAbilityStatuses after scheduled ones.)
            const timed = eng.timedAbilityStatuses('enemy');
            expect(timed).toHaveLength(1);
            expect(timed[0].payload.buffName).toBe('Armor Break');
        });

        it('activeAbilityStatuses enemy-side aura is visible without specifying a targetId', () => {
            const aura: RegisteredAbilityStatus = {
                kind: 'aura',
                side: 'enemy',
                sourceSlot: 'passive',
                conditions: [],
                payload: { buffName: 'WeakenAura', stacks: 1, parsedEffects: { defense: -5 } },
            };
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([aura]);
            eng.beginRound(1);
            const active = eng.activeAbilityStatuses('enemy', () => baseCtx);
            expect(active).toHaveLength(1);
            expect(active[0].payload.buffName).toBe('WeakenAura');
        });

        it('decrementEnemy decrements timed ability status on default target', () => {
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            const status = timedEnemyStatus('Def Down', 2);
            eng.registerAbilityStatuses([status]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, status);
            expect(eng.timedAbilityStatuses('enemy')).toHaveLength(1);
            eng.decrementEnemy(); // 2 → 1
            expect(eng.timedAbilityStatuses('enemy')).toHaveLength(1);
            expect(eng.timedAbilityStatuses('enemy')[0].active.turnsRemaining).toBe(1);
            eng.decrementEnemy(); // 1 → 0 → expired
            expect(eng.timedAbilityStatuses('enemy')).toHaveLength(0);
        });
    });

    describe('second target id isolation', () => {
        it('a debuff applied with enemyTargetId=tank does not appear in the default timedAbilityStatuses', () => {
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            const status = timedEnemyStatus('Shield Break', 2);
            eng.registerAbilityStatuses([status]);
            eng.beginRound(1);
            // 4th param is enemyTargetId — routes to the 'tank' store
            eng.applyTimedAbilityStatus(1, status, undefined, 'tank');
            // Default enemy target must have no debuffs
            expect(eng.timedAbilityStatuses('enemy')).toHaveLength(0);
            // Tank target has the debuff (3rd param = enemyTargetId)
            expect(
                eng.timedAbilityStatuses('enemy', undefined, 'tank').map((s) => s.payload.buffName)
            ).toEqual(['Shield Break']);
        });

        it('decrementEnemy with targetId=tank does not age default enemy debuffs', () => {
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            // Apply a 1-turn debuff to the default enemy
            const statusDefault = timedEnemyStatus('Def Down', 1);
            eng.registerAbilityStatuses([statusDefault]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, statusDefault);
            expect(eng.timedAbilityStatuses('enemy')).toHaveLength(1);
            // Decrement the tank target (empty) — must not touch the default enemy
            const { expired } = eng.decrementEnemy('tank');
            expect(expired).toEqual([]);
            expect(eng.timedAbilityStatuses('enemy')).toHaveLength(1);
        });

        it('decrementEnemy with targetId=tank only decrements the tank store', () => {
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            const tankStatus = timedEnemyStatus('Shield Break', 1);
            eng.registerAbilityStatuses([tankStatus]);
            eng.beginRound(1);
            // 4th param routes to 'tank'
            eng.applyTimedAbilityStatus(1, tankStatus, undefined, 'tank');
            // Ability-sourced statuses are in timedAbilityStatuses, not snapshot()
            // (3rd param = enemyTargetId)
            expect(eng.timedAbilityStatuses('enemy', undefined, 'tank')).toHaveLength(1);
            const { expired } = eng.decrementEnemy('tank');
            expect(expired).toEqual(['Shield Break']);
            expect(eng.timedAbilityStatuses('enemy', undefined, 'tank')).toHaveLength(0);
        });

        it('timedAbilityStatuses enemy targetId=tank returns only tank debuffs', () => {
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            const defaultStatus = timedEnemyStatus('Def Down', 2);
            const tankStatus = timedEnemyStatus('Armor Break', 2);
            eng.registerAbilityStatuses([defaultStatus, tankStatus]);
            eng.beginRound(1);
            eng.applyTimedAbilityStatus(1, defaultStatus);
            eng.applyTimedAbilityStatus(1, tankStatus, undefined, 'tank');
            const defaultTimed = eng.timedAbilityStatuses('enemy');
            expect(defaultTimed.map((s) => s.payload.buffName)).toEqual(['Def Down']);
            // 3rd param = enemyTargetId
            const tankTimed = eng.timedAbilityStatuses('enemy', undefined, 'tank');
            expect(tankTimed.map((s) => s.payload.buffName)).toEqual(['Armor Break']);
        });

        it('activeAbilityStatuses enemy aura is visible via default call (byte-identical baseline)', () => {
            // An aura registered with no targetId goes to the DEFAULT_ENEMY_TARGET store.
            // activeAbilityStatuses('enemy', ctx) — no 4th arg — reads the default store.
            const aura: RegisteredAbilityStatus = {
                kind: 'aura',
                side: 'enemy',
                sourceSlot: 'passive',
                conditions: [],
                payload: { buffName: 'GlobalWeaken', stacks: 1, parsedEffects: {} },
            };
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([aura]);
            eng.beginRound(1);
            const active = eng.activeAbilityStatuses('enemy', () => baseCtx);
            expect(active).toHaveLength(1);
            expect(active[0].payload.buffName).toBe('GlobalWeaken');
        });

        it('accumulating enemy status is visible via default call (byte-identical baseline)', () => {
            // An accumulating enemy-side status registered with no targetId goes to
            // DEFAULT_ENEMY_TARGET. activeAbilityStatuses('enemy', ctx) — no 4th arg —
            // reads the default store.
            const accum: RegisteredAbilityStatus = {
                kind: 'accumulating',
                side: 'enemy',
                sourceSlot: 'passive',
                conditions: [],
                stackTrigger: 'per-round',
                maxStacks: 10,
                payload: { buffName: 'WeakenAccum', stacks: 1, parsedEffects: { defense: -3 } },
            };
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([accum]);
            eng.beginRound(1); // per-round: stacks become 1
            const active = eng.activeAbilityStatuses('enemy', () => baseCtx);
            expect(active).toHaveLength(1);
            expect(active[0].payload.buffName).toBe('WeakenAccum');
            expect(active[0].active.stacks).toBe(1);
        });

        it('scheduled timed enemy debuffs (sourceFired) go to the default target and not to tank', () => {
            const debuff = makeBuff('Def Down', { skillSource: 'active', skillDuration: 2 });
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [debuff] });
            eng.beginRound(1);
            eng.sourceFired('attacker', 'active', 1);
            // Default enemy has the debuff
            expect(eng.snapshot().activeEnemyDebuffs).toHaveLength(1);
            // Tank target snapshot has nothing
            expect(eng.snapshot('attacker', 'tank').activeEnemyDebuffs).toHaveLength(0);
        });

        // --- New tests: accum + aura per-target isolation (Task 1 gap) ---

        it('accumulating enemy status registered for tank is absent from the default-key read', () => {
            // Register an accumulating enemy-side status explicitly under 'tank'.
            // activeAbilityStatuses('enemy', ctx, undefined, 'tank') must return it;
            // activeAbilityStatuses('enemy', ctx) — default key — must NOT.
            const accum: RegisteredAbilityStatus = {
                kind: 'accumulating',
                side: 'enemy',
                sourceSlot: 'passive',
                conditions: [],
                stackTrigger: 'per-round',
                maxStacks: 10,
                payload: {
                    buffName: 'TankWeaken',
                    stacks: 1,
                    parsedEffects: { defense: -5 },
                },
            };
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            // Register under 'tank' — 3rd param of registerAbilityStatuses is now overloaded
            // via the new registerAbilityStatuses(statuses, ownerId?, enemyTargetId?) signature
            // (enemy-side statuses route by enemyTargetId; self-side by ownerId).
            eng.registerAbilityStatuses([accum], undefined, 'tank');
            eng.beginRound(1); // per-round: stacks become 1 under 'tank'

            // 'tank' key reads the accum
            const tankActive = eng.activeAbilityStatuses('enemy', () => baseCtx, undefined, 'tank');
            expect(tankActive).toHaveLength(1);
            expect(tankActive[0].payload.buffName).toBe('TankWeaken');
            expect(tankActive[0].active.stacks).toBe(1);

            // Default key reads nothing for this buff
            const defaultActive = eng.activeAbilityStatuses('enemy', () => baseCtx);
            expect(defaultActive.find((s) => s.payload.buffName === 'TankWeaken')).toBeUndefined();
        });

        it('aura enemy status registered for tank is absent from the default-key read', () => {
            // Register an aura enemy-side status explicitly under 'tank'.
            // activeAbilityStatuses('enemy', ctx, undefined, 'tank') must return it;
            // activeAbilityStatuses('enemy', ctx) — default key — must NOT.
            const aura: RegisteredAbilityStatus = {
                kind: 'aura',
                side: 'enemy',
                sourceSlot: 'passive',
                conditions: [],
                payload: {
                    buffName: 'TankAura',
                    stacks: 1,
                    parsedEffects: { defense: -8 },
                },
            };
            const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            eng.registerAbilityStatuses([aura], undefined, 'tank');
            eng.beginRound(1);

            // 'tank' key sees the aura
            const tankActive = eng.activeAbilityStatuses('enemy', () => baseCtx, undefined, 'tank');
            expect(tankActive).toHaveLength(1);
            expect(tankActive[0].payload.buffName).toBe('TankAura');
            expect(tankActive[0].active.turnsRemaining).toBe('recurring');

            // Default key does NOT see this aura
            const defaultActive = eng.activeAbilityStatuses('enemy', () => baseCtx);
            expect(defaultActive.find((s) => s.payload.buffName === 'TankAura')).toBeUndefined();
        });
    });
});

describe('clearRemovable', () => {
    // A persistent-stacking debuff fixture (Defense Shred) on the default enemy target.
    const persistentShred = (): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 2, // ignored — name routes to the persistent map
        payload: {
            buffName: 'Defense Shred',
            stacks: 1,
            parsedEffects: { defense: -2 },
            application: 'inflict',
        },
    });

    // A timed enemy-side debuff fixture keyed to the default enemy target.
    const timedEnemyStatus = (
        buffName: string,
        duration: number
    ): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName, stacks: 1, parsedEffects: { defense: -5 } },
    });

    it('removes a timed self-buff and a timed enemy-debuff for the id', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Attack Up', 3), 'tank');
        eng.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 3), undefined, 'tank');
        // Sanity: both present before the wipe.
        expect(eng.timedAbilityStatuses('self', 'tank')).toHaveLength(1);
        expect(eng.timedAbilityStatuses('enemy', 'tank', 'tank')).toHaveLength(1);

        eng.clearRemovable('tank');

        expect(eng.timedAbilityStatuses('self', 'tank')).toEqual([]);
        expect(eng.timedAbilityStatuses('enemy', 'tank', 'tank')).toEqual([]);
    });

    it('preserves a persistent-stack debuff (Defense Shred)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // Apply the persistent debuff to the 'tank' enemy target store.
        eng.applyTimedAbilityStatus(1, persistentShred(), undefined, 'tank');
        // Also a removable timed debuff so we confirm the wipe ran.
        eng.applyTimedAbilityStatus(1, timedEnemyStatus('Defense Down', 3), undefined, 'tank');

        eng.clearRemovable('tank');

        const remaining = eng.timedAbilityStatuses('enemy', 'tank', 'tank');
        expect(remaining.map((s) => s.active.buffName)).toEqual(['Defense Shred']);
        expect(remaining[0].active.turnsRemaining).toBe('permanent');
    });

    it('preserves a buff named in UNREMOVABLE_STATUSES', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        // 'Immune Status' is injected into UNREMOVABLE_STATUSES via the module mock above.
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Immune Status', 3), 'tank');
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Attack Up', 3), 'tank');

        eng.clearRemovable('tank');

        const remaining = eng.timedAbilityStatuses('self', 'tank');
        expect(remaining.map((s) => s.payload.buffName)).toEqual(['Immune Status']);
    });

    it('is a no-op on an unknown id', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timedSelfStatus('Attack Up', 3), 'tank');
        // Wiping a different id must not touch 'tank'.
        expect(() => eng.clearRemovable('someone-else')).not.toThrow();
        expect(eng.timedAbilityStatuses('self', 'tank')).toHaveLength(1);
    });
});
