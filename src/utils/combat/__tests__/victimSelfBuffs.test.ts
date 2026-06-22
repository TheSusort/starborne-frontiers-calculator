/**
 * Direct unit tests for `victimSelfBuffs(statusEngine, victimId, selfBuffLookup)`.
 *
 * These tests cover all three internal channels:
 *
 *   1. Empty → returns [].
 *
 *   2. Timed ability channel (per-victim): a self-buff applied via
 *      applyTimedAbilityStatus(r, { side:'self', ... }, victimId) appears for victimId
 *      and toSelfIncomingDamageModifier returns the expected value.
 *
 *   3. Isolation: an ENEMY-side debuff applied to victimId does NOT appear via
 *      victimSelfBuffs (reads only the 'self' store).
 *
 *   4. Scheduled channel (selfBuffLookup): an activeSelfBuffs entry whose name is in
 *      selfBuffLookup is expanded and toSelfIncomingDamageModifier returns the looked-up
 *      value.
 *
 *   5. (Bonus) Self-buff on actor A is not returned when querying actor B.
 */
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import type { RegisteredAbilityStatus } from '../statusEngine';
import { victimSelfBuffs } from '../triggers';
import { toSelfIncomingDamageModifier } from '../../calculators/dpsBuffHelpers';
import type { SelectedGameBuff } from '../../../types/calculator';

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

/** A SelectedGameBuff with an incomingDamage parsedEffect, usable as a selfBuff lookup entry. */
function makeSelfBuff(buffName: string, incomingDamagePct: number): SelectedGameBuff {
    return {
        id: `test-${buffName}`,
        buffName,
        stacks: 1,
        parsedEffects: { incomingDamage: incomingDamagePct },
        isStackable: false,
        skillSource: 'active',
        skillDuration: 'recurring',
    };
}

/** Build a minimal timed RegisteredAbilityStatus (self-side). */
function timedSelfStatus(
    buffName: string,
    incomingDamagePct: number,
    duration = 3
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: {
            buffName,
            stacks: 1,
            parsedEffects: { incomingDamage: incomingDamagePct },
            application: 'apply',
        },
    };
}

/** Build a minimal timed RegisteredAbilityStatus (enemy-side), for the isolation test. */
function timedEnemyStatus(
    buffName: string,
    incomingDamagePct: number,
    duration = 3
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> {
    return {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: {
            buffName,
            stacks: 1,
            parsedEffects: { incomingDamage: incomingDamagePct },
            application: 'inflict',
        },
    };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('victimSelfBuffs — channel coverage', () => {
    // -----------------------------------------------------------------------
    // 1. Empty: no buffs applied → returns []
    // -----------------------------------------------------------------------
    it('empty: no buffs applied returns []', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);

        const result = victimSelfBuffs(eng, 'ship-1', new Map());

        expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // 2. Timed ability channel: a self-buff with incomingDamage: -30 is returned,
    //    and toSelfIncomingDamageModifier returns -30.
    // -----------------------------------------------------------------------
    it('timed ability channel: self-buff with incomingDamage returns correct modifier', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);

        const status = timedSelfStatus('Inc. Damage Down', -30);
        // Apply to 'ship-1' via the self-side recipientId (3rd arg).
        eng.applyTimedAbilityStatus(1, status, 'ship-1');

        const result = victimSelfBuffs(eng, 'ship-1', new Map());

        expect(result.some((b) => b.buffName === 'Inc. Damage Down')).toBe(true);
        expect(toSelfIncomingDamageModifier(result)).toBe(-30);
    });

    // -----------------------------------------------------------------------
    // 3. Isolation: an enemy-side debuff applied to 'ship-1' is NOT returned by
    //    victimSelfBuffs — it reads only the 'self' store.
    // -----------------------------------------------------------------------
    it('isolation: enemy-side debuff on victim is NOT returned by victimSelfBuffs', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);

        const enemyStatus = timedEnemyStatus('Enemy Inc. Damage Up', 20);
        // Apply as enemy-side debuff — recipientId (3rd arg) is irrelevant for enemy-side,
        // enemyTargetId (4th arg) routes to 'ship-1'.
        eng.applyTimedAbilityStatus(1, enemyStatus, undefined, 'ship-1');

        const result = victimSelfBuffs(eng, 'ship-1', new Map());

        expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // 4. Scheduled channel (channel 1): a timed scheduled self-buff (seeded via
    //    createStatusEngine({ selfBuffs: [...] }) + sourceFired) appears in
    //    snapshot('attacker').activeSelfBuffs as a BARE NAME ENTRY — its payload/effects
    //    carry NO incomingDamage. The value MUST come from selfBuffLookup. Guard: the test
    //    fails if selfBuffLookup is empty (verifies channel 1 is genuinely wired).
    //
    //    How seeding works:
    //      createStatusEngine receives a SelectedGameBuff with skillSource:'active' and a
    //      numeric skillDuration — isAlwaysActive() returns false so it goes into timedSelf.
    //      sourceFired('attacker','active',1) upserts it into getSelfMap('attacker') via
    //      upsertBuff(), which stores NO payload (scheduled path). snapshot('attacker')
    //      returns it in activeSelfBuffs as { buffName, turnsRemaining } with no effects.
    //      expandBuffEntry() calls selfBuffLookup.get(buffName) to obtain the effects.
    // -----------------------------------------------------------------------
    it('scheduled channel: activeSelfBuffs bare-name entry expanded via selfBuffLookup gives correct modifier', () => {
        const buffName = 'Makoli Shelter';
        // The lookup carries the incomingDamage effect; the scheduled entry itself carries NONE.
        const lookupEntry = makeSelfBuff(buffName, -15);
        const selfBuffLookup = new Map<string, SelectedGameBuff[]>([[buffName, [lookupEntry]]]);

        // Seed a TIMED scheduled self-buff. parsedEffects is empty — no incomingDamage here.
        // skillSource:'active' + numeric skillDuration → isAlwaysActive() false → goes to timedSelf.
        const scheduledBuff: SelectedGameBuff = {
            id: 'test-scheduled-shelter',
            buffName,
            stacks: 1,
            parsedEffects: {},
            isStackable: false,
            skillSource: 'active',
            skillDuration: 2,
        };
        const eng = createStatusEngine({ selfBuffs: [scheduledBuff], enemyDebuffs: [] });
        eng.beginRound(1);
        // Fire the attacker's active slot so the timed scheduled self-buff is upserted to
        // getSelfMap('attacker') with NO payload — channel 1 write path.
        eng.sourceFired('attacker', 'active', 1);

        // victimId 'attacker' — scheduled timed self-buffs always land in the 'attacker' owner map.
        const result = victimSelfBuffs(eng, 'attacker', selfBuffLookup);

        expect(result.some((b) => b.buffName === buffName)).toBe(true);
        expect(toSelfIncomingDamageModifier(result)).toBe(-15);

        // Guard: with an empty lookup the same call yields NO incomingDamage contribution.
        // This proves the value comes from the lookup, not from the scheduled entry's own payload.
        const resultNoLookup = victimSelfBuffs(eng, 'attacker', new Map());
        expect(toSelfIncomingDamageModifier(resultNoLookup)).toBe(0);
    });

    // -----------------------------------------------------------------------
    // 5. (Bonus) Self-buff on actor A is NOT returned when querying actor B.
    // -----------------------------------------------------------------------
    it('per-victim isolation: self-buff on actor A does not appear for actor B', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);

        const status = timedSelfStatus('Actor A Buff', -10);
        eng.applyTimedAbilityStatus(1, status, 'actor-A');

        const forA = victimSelfBuffs(eng, 'actor-A', new Map());
        const forB = victimSelfBuffs(eng, 'actor-B', new Map());

        expect(forA.some((b) => b.buffName === 'Actor A Buff')).toBe(true);
        expect(forB.some((b) => b.buffName === 'Actor A Buff')).toBe(false);
    });
});
