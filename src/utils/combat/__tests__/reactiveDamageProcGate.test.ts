/**
 * Reactive damage branch honors procChance (passesProcChanceGate).
 *
 * Tests that:
 * (a) A reactive `damage` intent with procChance 0.5 over 10 calls fires ctx.applyReactiveDamage
 *     exactly 5 times (the deterministic makeRateGate(0.5) accumulator fires 5/10 — back-loaded:
 *     calls 2,4,6,8,10). Must NOT be 10 (today's broken behavior).
 * (b) A reactive `damage` intent without procChance fires ctx.applyReactiveDamage on every call
 *     (pass-through — byte-identical to today).
 *
 * The branch now delegates to `ctx.applyReactiveDamage` (mitigated/crit walk) instead of
 * the old credit-only `ctx.creditReactiveDamage` — updated to spy on the new delegate. The gate
 * behavior under test (procChance) is UNCHANGED (it runs before either delegate is reached).
 */
import { describe, it, expect, vi } from 'vitest';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner1';
const ABILITY_ID = 'reactive-damage-ab';

function makeDamageIntent(opts?: { procChance?: number }): Intent {
    return {
        ownerId: OWNER_ID,
        sourceSlot: 'passive',
        ability: {
            id: ABILITY_ID,
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-cleansed',
            conditions: [],
            ...(opts?.procChance !== undefined ? { procChance: opts.procChance } : {}),
            config: { type: 'damage', multiplier: 75, hits: 1 },
        },
    } as unknown as Intent;
}

/**
 * Build a minimal IntentExecContext for the damage branch.
 *
 * The damage branch in executeIntent reads:
 *   - ctx.runtimes.get(intent.ownerId)  → must exist (throws if missing)
 *   - ctx.lastTurnCtxByActor.get(intent.ownerId) → can be undefined (falls back to base stats)
 *   - ctx.applyReactiveDamage  → the spy we track
 *   - ctx.procChanceGates  → provided when testing the gate; absent when testing pass-through
 *
 * Condition gate: intent.ability.conditions is [] → conditionsMet → passes.
 */
function makeCtx(opts?: {
    procChanceGates?: Map<string, ReturnType<typeof makeRateGate>>;
    applyReactiveDamage?: IntentExecContext['applyReactiveDamage'];
}): IntentExecContext {
    const bus = createEventBus();
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

    return {
        round: 1,
        statusEngine: se,
        bus,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([
            [
                OWNER_ID,
                {
                    actor: { id: OWNER_ID, chargeCount: 0, charges: 0 } as unknown as CombatActor,
                    attack: 10000,
                    defence: 0,
                    hp: 10000,
                    healModifier: 0,
                    selfDotModifier: 0,
                    defensePenetrationBuff: 0,
                    affinityDamageModifier: 0,
                    affinityCritCap: 100,
                    affinityCritPenalty: 0,
                    affinityDisadvantage: false,
                    selfBuffLookup: new Map(),
                    enemyDebuffLookup: new Map(),
                } as never,
            ],
        ]),
        grantAllyCharges: () => {},
        removeEnemyCharges: () => {},
        removeChargesFrom: () => {},
        grantExtraAction: () => {},
        playerIds: [OWNER_ID],
        lastTurnCtxByActor: new Map([
            [
                OWNER_ID,
                {
                    effectiveAttack: 10000,
                    affinityMult: 1,
                } as never,
            ],
        ]),
        recordResisted: () => {},
        procChanceGates: opts?.procChanceGates,
        applyReactiveDamage: opts?.applyReactiveDamage,
        // The damage branch's no-eventCtx arm routes to the first LIVING opposing actor
        // and, since that rung, NO-OPS on an empty roster instead of falling back to the vestigial
        // `enemy` dummy. Without this delegate every case here would no-op before reaching the
        // proc gate it is about — green, and completely vacuous.
        livingOpposingActorIds: () => ['victim1'],
        // FIX 3: now required — this suite has no lowest-hp-ally consumer, so "nobody" is the
        // honest answer, supplied explicitly rather than by omission.
        lowestHpAllyIdFor: () => undefined,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D-PR4 T5: reactive damage branch — passesProcChanceGate', () => {
    it('(a) procChance 0.5 over 10 calls fires ctx.applyReactiveDamage exactly 5 times (not 10)', () => {
        const creditSpy = vi.fn();

        // Shared gate map — same owner+ability key re-uses ONE gate across all 10 calls,
        // producing the deterministic 5/10 accumulator schedule (fires on calls 2,4,6,8,10).
        const procChanceGates = new Map<string, ReturnType<typeof makeRateGate>>();
        const intent = makeDamageIntent({ procChance: 0.5 });
        const ctx = makeCtx({ procChanceGates, applyReactiveDamage: creditSpy });

        for (let i = 0; i < 10; i++) {
            executeIntent(intent, ctx);
        }

        // The deterministic accumulator fires exactly 5/10 times (back-loaded).
        expect(creditSpy).toHaveBeenCalledTimes(5);
    });

    it('(b) no procChance: ctx.applyReactiveDamage fires on all 4 calls (pass-through)', () => {
        const creditSpy = vi.fn();

        const procChanceGates = new Map<string, ReturnType<typeof makeRateGate>>();
        const intent = makeDamageIntent(/* no procChance */);
        const ctx = makeCtx({ procChanceGates, applyReactiveDamage: creditSpy });

        for (let i = 0; i < 4; i++) {
            executeIntent(intent, ctx);
        }

        // No gate → fires every time.
        expect(creditSpy).toHaveBeenCalledTimes(4);
    });
});
