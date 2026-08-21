/**
 * D-PR14 (Phase 4 charge / FrontLine enabling work): the reactive `damage` and
 * `heal|shield` executor branches honor `Ability.oncePerRound` via the shared
 * `passesOncePerRoundGate` helper.
 *
 * Tests that:
 * (a) A reactive `damage` ability with oncePerRound:true credits damage on the FIRST
 *     qualifying trigger in a round but NOT on a second trigger the same round, and
 *     resets next round (after the engine clears oncePerRoundConsumed).
 * (b) A reactive `shield` ability with oncePerRound:true grants shield on the FIRST
 *     trigger in a round but NOT on a second the same round, and resets next round.
 * (c) Without oncePerRound the helper is pass-through (every trigger fires) — confirming
 *     the new gate does not disturb existing (non-oncePerRound) damage/shield reactives.
 *
 * The debuff branch keeps its own inline split (Bulwark) and is NOT exercised here.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';

const OWNER_ID = 'owner1';

function makeDamageIntent(opts?: { oncePerRound?: boolean }): Intent {
    return {
        ownerId: OWNER_ID,
        sourceSlot: 'passive',
        ability: {
            id: 'reactive-damage-opr',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-enemy-charged-cast',
            conditions: [],
            ...(opts?.oncePerRound ? { oncePerRound: true } : {}),
            config: { type: 'damage', multiplier: 75, hits: 1 },
        },
    } as unknown as Intent;
}

function makeShieldIntent(opts?: { oncePerRound?: boolean }): Intent {
    return {
        ownerId: OWNER_ID,
        sourceSlot: 'passive',
        ability: {
            id: 'reactive-shield-opr',
            type: 'shield',
            target: 'self',
            trigger: 'on-enemy-charged-cast',
            conditions: [],
            ...(opts?.oncePerRound ? { oncePerRound: true } : {}),
            config: { type: 'shield', basis: 'max-hp', pct: 20 },
        },
    } as unknown as Intent;
}

function makeCtx(opts?: {
    round?: number;
    oncePerRoundConsumed?: Set<string>;
    applyReactiveDamage?: IntentExecContext['applyReactiveDamage'];
    healing?: IntentExecContext['healing'];
}): IntentExecContext {
    const bus = createEventBus();
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

    return {
        round: opts?.round ?? 1,
        statusEngine: se,
        bus,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([
            [
                OWNER_ID,
                {
                    actor: {
                        id: OWNER_ID,
                        currentHp: 10000,
                        chargeCount: 0,
                        charges: 0,
                    } as unknown as CombatActor,
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
            [OWNER_ID, { effectiveAttack: 10000, affinityMult: 1, effectiveMaxHp: 10000 } as never],
        ]),
        enemyHp: 100000,
        recordResisted: () => {},
        applyReactiveDamage: opts?.applyReactiveDamage,
        oncePerRoundConsumed: opts?.oncePerRoundConsumed,
        healing: opts?.healing,
        // SP-4c-2d: the damage branch's no-eventCtx arm routes to the first LIVING opposing actor
        // and, since that rung, NO-OPS on an empty roster instead of falling back to the vestigial
        // `enemy` dummy. Without this delegate the damage cases here would no-op before reaching
        // the once-per-round gate they are about — green, and completely vacuous.
        livingOpposingActorIds: () => ['victim1'],
        // FIX 3: now required — this suite has no lowest-hp-ally consumer, so "nobody" is the
        // honest answer, supplied explicitly rather than by omission.
        lowestHpAllyIdFor: () => undefined,
    } as IntentExecContext;
}

describe('D-PR14: reactive damage/shield branches — passesOncePerRoundGate', () => {
    it('(a) damage oncePerRound: fires once this round, not twice, resets next round', () => {
        const creditSpy = vi.fn();
        const consumed = new Set<string>();
        const intent = makeDamageIntent({ oncePerRound: true });

        // Round 1: two triggers, only the first credits.
        const ctx1 = makeCtx({
            round: 1,
            oncePerRoundConsumed: consumed,
            applyReactiveDamage: creditSpy,
        });
        executeIntent(intent, ctx1);
        executeIntent(intent, ctx1);
        expect(creditSpy).toHaveBeenCalledTimes(1);

        // Engine clears the per-round Set at round boundary.
        consumed.clear();
        const ctx2 = makeCtx({
            round: 2,
            oncePerRoundConsumed: consumed,
            applyReactiveDamage: creditSpy,
        });
        executeIntent(intent, ctx2);
        expect(creditSpy).toHaveBeenCalledTimes(2);
    });

    it('(c-damage) no oncePerRound: damage fires on every trigger (pass-through)', () => {
        const creditSpy = vi.fn();
        const consumed = new Set<string>();
        const intent = makeDamageIntent(/* no oncePerRound */);
        const ctx = makeCtx({ oncePerRoundConsumed: consumed, applyReactiveDamage: creditSpy });

        executeIntent(intent, ctx);
        executeIntent(intent, ctx);
        executeIntent(intent, ctx);
        expect(creditSpy).toHaveBeenCalledTimes(3);
    });

    it('(b) shield oncePerRound: grants once this round, not twice, resets next round', () => {
        const shieldSpy = vi.fn();
        const consumed = new Set<string>();
        const intent = makeShieldIntent({ oncePerRound: true });

        const healing: IntentExecContext['healing'] = {
            targetId: OWNER_ID,
            credit: () => {},
            applyHealToTarget: () => ({ consumed: 0, overheal: 0 }),
            grantShieldToTarget: shieldSpy,
            recipientMaxHp: () => 10000,
            recipientIncomingHealPct: () => 0,
            // Task 0.1: the reactive shield branch now routes per-recipient via recipientActor
            // (target:'self' → recipient is OWNER_ID). Resolve it to a truthy actor so the
            // per-recipient grant fires (mirrors the live HealingRuntimeCtx).
            recipientActor: (id: string) =>
                id === OWNER_ID ? ({ id: OWNER_ID } as unknown as CombatActor) : undefined,
        } as unknown as IntentExecContext['healing'];

        const ctx1 = makeCtx({ round: 1, oncePerRoundConsumed: consumed, healing });
        executeIntent(intent, ctx1);
        executeIntent(intent, ctx1);
        expect(shieldSpy).toHaveBeenCalledTimes(1);

        consumed.clear();
        const ctx2 = makeCtx({ round: 2, oncePerRoundConsumed: consumed, healing });
        executeIntent(intent, ctx2);
        expect(shieldSpy).toHaveBeenCalledTimes(2);
    });

    it('(c-shield) no oncePerRound: shield grants on every trigger (pass-through)', () => {
        const shieldSpy = vi.fn();
        const consumed = new Set<string>();
        const intent = makeShieldIntent(/* no oncePerRound */);

        const healing: IntentExecContext['healing'] = {
            targetId: OWNER_ID,
            credit: () => {},
            applyHealToTarget: () => ({ consumed: 0, overheal: 0 }),
            grantShieldToTarget: shieldSpy,
            recipientMaxHp: () => 10000,
            recipientIncomingHealPct: () => 0,
            // Task 0.1: resolve the self-recipient to a truthy actor so the per-recipient grant
            // fires (mirrors the live HealingRuntimeCtx).
            recipientActor: (id: string) =>
                id === OWNER_ID ? ({ id: OWNER_ID } as unknown as CombatActor) : undefined,
        } as unknown as IntentExecContext['healing'];

        const ctx = makeCtx({ oncePerRoundConsumed: consumed, healing });
        executeIntent(intent, ctx);
        executeIntent(intent, ctx);
        expect(shieldSpy).toHaveBeenCalledTimes(2);
    });
});
