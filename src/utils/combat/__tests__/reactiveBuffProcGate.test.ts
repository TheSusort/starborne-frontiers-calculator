/**
 * D-PR8 Task 3: reactive buff branch honors procChance (passesProcChanceGate).
 *
 * Tests that:
 * (a) A reactive `buff` intent with procChance 0.2 over 10 calls does NOT apply the buff
 *     every time — the deterministic makeRateGate(0.2) accumulator fires 2/10 times
 *     (back-loaded: calls 5, 10). Must NOT be 10 (absent gate = broken behavior).
 * (b) A reactive `buff` intent WITHOUT procChance applies the buff on every call
 *     (pass-through — byte-identical to today).
 */
import { describe, it, expect } from 'vitest';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner1';
const ABILITY_ID = 'reactive-buff-ab';

function makeBuffIntent(opts?: { procChance?: number }): Intent {
    return {
        ownerId: OWNER_ID,
        sourceSlot: 'passive',
        ability: {
            id: ABILITY_ID,
            type: 'buff',
            target: 'self',
            trigger: 'on-crit',
            conditions: [],
            ...(opts?.procChance !== undefined ? { procChance: opts.procChance } : {}),
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                stacks: 1,
                duration: 2,
                parsedEffects: {},
            },
        },
    } as unknown as Intent;
}

/**
 * Build a minimal IntentExecContext for the buff branch.
 *
 * The buff branch in executeIntent reads:
 *   - ctx.runtimes.get(intent.ownerId)  → must exist (throws if missing)
 *   - ctx.statusEngine                  → applyTimedAbilityStatus is called on buff apply
 *   - ctx.bus                           → buff-applied event is emitted
 *   - ctx.playerIds                     → recipient resolution for 'self' target (falls back to [ownerId])
 *   - ctx.procChanceGates               → provided when testing the gate; absent for pass-through
 *
 * Condition gate: intent.ability.conditions is [] → conditionsMet → passes.
 * StatusEngine must be advanced to round 1 (beginRound) before executeIntent is called.
 */
function makeCtx(opts?: {
    procChanceGates?: Map<string, ReturnType<typeof makeRateGate>>;
}): IntentExecContext & { buffAppliedEvents: string[] } {
    const bus = createEventBus();
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    // Advance to round 1 so applyTimedAbilityStatus accepts round=1 calls.
    se.beginRound(1);

    const buffAppliedEvents: string[] = [];
    bus.on('buff-applied', (e) => {
        buffAppliedEvents.push(e.buffName);
    });

    const ctx = {
        round: 1,
        enemy: { id: 'enemy1', currentHp: 100000 } as CombatActor,
        enemyId: 'enemy1',
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
        enemyHp: 100000,
        cumulativeDamage: 0,
        recordResisted: () => {},
        procChanceGates: opts?.procChanceGates,
    } as unknown as IntentExecContext & { buffAppliedEvents: string[] };

    (ctx as unknown as Record<string, unknown>).buffAppliedEvents = buffAppliedEvents;
    return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D-PR8 T3: reactive buff branch — passesProcChanceGate', () => {
    it('(a) procChance 0.2 over 10 calls fires buff-applied exactly 2 times (not 10)', () => {
        // Shared gate map — same owner+ability key re-uses ONE gate across all 10 calls,
        // producing the deterministic 2/10 accumulator schedule (fires on calls 5, 10).
        const procChanceGates = new Map<string, ReturnType<typeof makeRateGate>>();
        const intent = makeBuffIntent({ procChance: 0.2 });
        const ctx = makeCtx({ procChanceGates });

        for (let i = 0; i < 10; i++) {
            executeIntent(intent, ctx);
        }

        // The deterministic accumulator fires exactly 2/10 times.
        expect(ctx.buffAppliedEvents).toHaveLength(2);
    });

    it('(b) no procChance: buff-applied fires on all 4 calls (pass-through)', () => {
        const procChanceGates = new Map<string, ReturnType<typeof makeRateGate>>();
        const intent = makeBuffIntent(/* no procChance */);
        const ctx = makeCtx({ procChanceGates });

        for (let i = 0; i < 4; i++) {
            executeIntent(intent, ctx);
        }

        // No gate → fires every time.
        expect(ctx.buffAppliedEvents).toHaveLength(4);
    });
});
