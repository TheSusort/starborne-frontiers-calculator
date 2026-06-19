/**
 * Direct unit tests for `victimEnemyBuffs(statusEngine, targetId, enemyDebuffLookup)`.
 *
 * These tests cover all three internal channels:
 *
 *   1. Scheduled channel (global '__enemy__'): debuffs written via sourceFired → upsertBuff →
 *      DEFAULT_ENEMY_TARGET. These are GLOBAL — they appear for ANY victim id.
 *
 *   2. Timed ability channel (per-victim): debuffs applied via applyTimedAbilityStatus with an
 *      explicit enemyTargetId. These are PER-VICTIM — they appear only for that victim's id.
 *
 *   3. Aura/accumulating channel (per-victim, I1 approximation): debuffs registered via
 *      registerAbilityStatuses with kind:'aura'|'accumulating' for a specific enemyTargetId.
 *      victimEnemyBuffs reads these via activeAbilityStatuses('enemy', () => NEUTRAL_NAMES_CTX, ...)
 *      using a NEUTRAL gating ctx and NO landing re-roll — an accepted approximation that mirrors
 *      ownerDebuffNamesFor (finding I1). This channel was previously untested (all B1 tests used
 *      timed inflict/apply debuffs only); adding coverage here is the I1 fast-follow.
 */
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import type { RegisteredAbilityStatus } from '../statusEngine';
import { victimEnemyBuffs } from '../triggers';
import type { SelectedGameBuff } from '../../../types/calculator';

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

/** A SelectedGameBuff with a defense parsedEffect, usable as a debuff lookup entry. */
function makeDebuff(buffName: string, defensePct: number): SelectedGameBuff {
    return {
        id: `test-${buffName}`,
        buffName,
        stacks: 1,
        parsedEffects: { defense: defensePct },
        isStackable: false,
        skillSource: 'active',
        skillDuration: 'recurring',
    };
}

/** Build a minimal timed RegisteredAbilityStatus (enemy-side). */
function timedEnemyStatus(
    buffName: string,
    defensePct: number,
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
            parsedEffects: { defense: defensePct },
            application: 'inflict',
        },
    };
}

/** Build a minimal aura RegisteredAbilityStatus (enemy-side, no conditions = always passes). */
function auraEnemyStatus(
    buffName: string,
    defensePct: number
): Extract<RegisteredAbilityStatus, { kind: 'aura' }> {
    return {
        kind: 'aura',
        side: 'enemy',
        sourceSlot: 'passive',
        conditions: [],
        payload: {
            buffName,
            stacks: 1,
            parsedEffects: { defense: defensePct },
        },
    };
}

/** Build a minimal accumulating RegisteredAbilityStatus (enemy-side, per-round trigger). */
function accumEnemyStatus(
    buffName: string,
    defensePct: number
): Extract<RegisteredAbilityStatus, { kind: 'accumulating' }> {
    return {
        kind: 'accumulating',
        side: 'enemy',
        sourceSlot: 'passive',
        conditions: [],
        stackTrigger: 'per-round',
        maxStacks: 10,
        payload: {
            buffName,
            stacks: 1,
            parsedEffects: { defense: defensePct },
        },
    };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('victimEnemyBuffs — channel coverage', () => {
    // -----------------------------------------------------------------------
    // 1. Scheduled channel is GLOBAL
    //    A scheduled enemy debuff (non-payload, written via sourceFired → upsertBuff →
    //    DEFAULT_ENEMY_TARGET '__enemy__') appears for any arbitrarily chosen victim id.
    // -----------------------------------------------------------------------
    it('scheduled channel: a scheduled enemy debuff appears for an arbitrary victim id (global)', () => {
        const scheduledDebuff = makeDebuff('Sched Defense Down', -25);
        const lookup = new Map<string, SelectedGameBuff[]>([
            ['Sched Defense Down', [scheduledDebuff]],
        ]);

        const eng = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [scheduledDebuff],
        });

        eng.beginRound(1);
        // Fire the attacker slot so the scheduled timed debuff is applied to DEFAULT_ENEMY_TARGET.
        eng.sourceFired('attacker', 'active', 1);

        // Read for an arbitrary victim id that is NOT DEFAULT_ENEMY_TARGET.
        const result = victimEnemyBuffs(eng, 'arbitrary-victim', lookup);

        // The scheduled debuff appears because victimEnemyBuffs always reads the global
        // '__enemy__' store for the scheduled channel, regardless of victimId.
        expect(result.length).toBeGreaterThan(0);
        expect(result.some((b) => b.buffName === 'Sched Defense Down')).toBe(true);

        // Also verify it appears for a completely different victim id.
        const result2 = victimEnemyBuffs(eng, 'another-victim', lookup);
        expect(result2.some((b) => b.buffName === 'Sched Defense Down')).toBe(true);
    });

    // -----------------------------------------------------------------------
    // 2. Timed ability channel is PER-VICTIM
    //    A timed enemy debuff applied via applyTimedAbilityStatus(r, status, _, 'victimA')
    //    appears for 'victimA' but NOT for 'victimB'.
    // -----------------------------------------------------------------------
    it('timed ability channel: debuff applied to victimA is visible for victimA but not victimB', () => {
        const lookup = new Map<string, SelectedGameBuff[]>();
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

        eng.beginRound(1);

        const status = timedEnemyStatus('Timed Def Down', -30);
        // Apply to 'victimA' explicitly.
        eng.applyTimedAbilityStatus(1, status, undefined, 'victimA');

        const forVictimA = victimEnemyBuffs(eng, 'victimA', lookup);
        const forVictimB = victimEnemyBuffs(eng, 'victimB', lookup);

        // victimA carries the timed ability debuff.
        expect(forVictimA.some((b) => b.buffName === 'Timed Def Down')).toBe(true);
        // victimB does NOT carry it — per-victim isolation.
        expect(forVictimB.some((b) => b.buffName === 'Timed Def Down')).toBe(false);
    });

    // -----------------------------------------------------------------------
    // 3. Aura/accumulating channel is READ (I1 gap coverage)
    //    registerAbilityStatuses with kind:'aura'|'accumulating' for a specific enemyTargetId
    //    seeds the aura/accum maps for that target. victimEnemyBuffs reads them via
    //    activeAbilityStatuses('enemy', () => NEUTRAL_NAMES_CTX, ...) and includes them in
    //    the returned SelectedGameBuff[]. This is the previously-untested branch (finding I1).
    //
    //    APPROXIMATION contract: the read uses NEUTRAL ctx and NO landing re-roll — the
    //    conditions in our test aura/accum statuses are empty ([]) so the gate always passes
    //    and the approximation matches exact behaviour for this case.
    // -----------------------------------------------------------------------
    it('aura channel: a registered enemy aura status is returned by victimEnemyBuffs (I1 branch)', () => {
        const lookup = new Map<string, SelectedGameBuff[]>();
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

        // Register an aura enemy status for 'aura-victim' before beginRound.
        const aura = auraEnemyStatus('Aura Defense Down', -20);
        eng.registerAbilityStatuses([aura], 'attacker', 'aura-victim');

        eng.beginRound(1);

        const result = victimEnemyBuffs(eng, 'aura-victim', lookup);

        // The aura status must be included (the I1-gap branch is read).
        expect(result.some((b) => b.buffName === 'Aura Defense Down')).toBe(true);
        // The returned buff has the expected defense effect.
        const found = result.find((b) => b.buffName === 'Aura Defense Down');
        expect(found).toBeDefined();
        expect(found!.parsedEffects.defense).toBe(-20);
    });

    it('accumulating channel: a registered enemy accumulating status (stacks > 0) is returned (I1 branch)', () => {
        const lookup = new Map<string, SelectedGameBuff[]>();
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

        // Register a per-round accumulating enemy status for 'accum-victim'.
        const accum = accumEnemyStatus('Accum Defense Down', -15);
        eng.registerAbilityStatuses([accum], 'attacker', 'accum-victim');

        // beginRound increments per-round accumulating stacks by the rate (1), so stacks = 1
        // after round 1 starts — enough to appear in activeAbilityStatuses (stacks > 0 gate).
        eng.beginRound(1);

        const result = victimEnemyBuffs(eng, 'accum-victim', lookup);

        // The accumulating status must be included (stacks = 1 after round 1's increment).
        expect(result.some((b) => b.buffName === 'Accum Defense Down')).toBe(true);
        const found = result.find((b) => b.buffName === 'Accum Defense Down');
        expect(found).toBeDefined();
        expect(found!.parsedEffects.defense).toBe(-15);
    });

    // The aura/accum entry is keyed to the registered enemyTargetId — it does NOT appear for
    // a different victim id (per-victim isolation preserved by the aura/accum maps).
    it('aura/accumulating channels are per-victim: entries do not bleed to other victim ids', () => {
        const lookup = new Map<string, SelectedGameBuff[]>();
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

        const aura = auraEnemyStatus('Aura Def Down Isolated', -10);
        eng.registerAbilityStatuses([aura], 'attacker', 'target-X');

        eng.beginRound(1);

        // Registered for 'target-X' — appears there.
        const forX = victimEnemyBuffs(eng, 'target-X', lookup);
        expect(forX.some((b) => b.buffName === 'Aura Def Down Isolated')).toBe(true);

        // Does NOT appear for a different victim id.
        const forY = victimEnemyBuffs(eng, 'target-Y', lookup);
        expect(forY.some((b) => b.buffName === 'Aura Def Down Isolated')).toBe(false);
    });
});
