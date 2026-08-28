/**
 * H3.1 — reactive `damage-taken` shield basis.
 *
 * A reactive `on-attacked` shield whose config basis is `damage-taken` (e.g. the Adaptive
 * Plating implant: "shield = X% of the damage taken") must scale off the magnitude of the
 * triggering hit, NOT the owner's Max HP.
 *
 * This test exercises BOTH halves of the H3.1 fix as one path:
 *   (a) the `on-attacked` listener stamps the hit's `e.damage` into `eventCtx.triggerDamage`;
 *   (b) the heal/shield executor's `damage-taken` basis reads that `triggerDamage`.
 *
 * Step 1 drives the live listener (the same `registerReactiveListeners` + bus harness used by
 * the Task-4 on-attacked tests) and emits an `attacked` event carrying a KNOWN damage D. The
 * enqueued intent is captured. Step 2 feeds that intent through `executeIntent` with a
 * `grantShieldToTarget` spy and asserts the granted pool === 0.50 × D.
 *
 * PRE-FIX this fails twice over: the listener never threads `e.damage` (so triggerDamage is
 * undefined), and even if it did the `damage-taken` basis falls through to effectiveMaxHp — so
 * the grant would be 0.50 × maxHp (50,000 → 25,000), far larger than 0.50 × D (3,000 → 1,500).
 */
import { describe, it, expect, vi } from 'vitest';
import {
    registerReactiveListeners,
    executeIntent,
    Intent,
    IntentExecContext,
    ReactiveAbility,
} from '../triggers';
import { createEventBus } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import type { ShieldGrantResult } from '../playerTurn';
import type { Ability } from '../../../types/abilities';

const OWNER_ID = 'carrier';
const D = 3_000; // known incoming hit damage
const MAX_HP = 50_000; // deliberately far from 0.5×D so a maxHp fall-through is unmistakable

// A reactive self-shield that grants 50% of the DAMAGE TAKEN when the owner is attacked.
// No procChance → always fires.
const damageTakenShield = (): Ability => ({
    id: 'adaptive-plating',
    type: 'shield',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'shield', pct: 50, basis: 'damage-taken' },
});

// Drive the live on-attacked listener and capture the enqueued intent. Mirrors the Task-4
// emitAttacked harness in triggers.test.ts.
function captureIntentForAttack(damage: number): Intent {
    const bus = createEventBus();
    const ra: ReactiveAbility = { ability: damageTakenShield(), sourceSlot: 'passive' };
    const intents: Intent[] = [];
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: OWNER_ID, reactiveAbilities: [ra] }],
        enqueue: (i) => intents.push(i),
        isOpposing: (id) => id === 'enemy',
    });
    bus.emit({ type: 'attacked', targetId: OWNER_ID, attackerId: 'enemy', round: 1, damage });
    expect(intents).toHaveLength(1);
    return intents[0];
}

function makeShieldCtx(
    grantShieldToTarget: (raw: number, actor: CombatActor) => ShieldGrantResult
): {
    ctx: IntentExecContext;
} {
    const bus = createEventBus();
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

    const healing: IntentExecContext['healing'] = {
        targetId: OWNER_ID,
        credit: () => {},
        applyHealToTarget: () => ({ reversed: false as const, consumed: 0, overheal: 0 }),
        grantShieldToTarget,
        recipientMaxHp: () => MAX_HP,
        recipientIncomingHealPct: () => 0,
        // self-target → recipient is OWNER_ID; resolve it to a truthy actor so the grant fires.
        recipientActor: (id: string) =>
            id === OWNER_ID ? ({ id: OWNER_ID } as unknown as CombatActor) : undefined,
    } as unknown as IntentExecContext['healing'];

    const ctx = {
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
                    actor: {
                        id: OWNER_ID,
                        currentHp: MAX_HP,
                        chargeCount: 0,
                        charges: 0,
                    } as unknown as CombatActor,
                    attack: 10000,
                    defence: 0,
                    hp: MAX_HP,
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
                { effectiveAttack: 10000, affinityMult: 1, effectiveMaxHp: MAX_HP } as never,
            ],
        ]),
        recordResisted: () => {},
        healing,
        // FIX 3: now required — this suite has no lowest-hp-ally consumer, so "nobody" is the
        // honest answer, supplied explicitly rather than by omission.
        lowestHpAllyIdFor: () => undefined,
    } as IntentExecContext;

    return { ctx };
}

describe('H3.1 — reactive damage-taken shield basis', () => {
    it('grants a shield of 50% of the DAMAGE TAKEN (not 50% of Max HP) when attacked', () => {
        // Step 1: the on-attacked listener must thread the hit damage into eventCtx.
        const intent = captureIntentForAttack(D);
        expect(intent.eventCtx?.triggerDamage).toBe(D);

        // Step 2: the executor's damage-taken basis reads triggerDamage.
        const grantSpy = vi.fn<(raw: number, actor: CombatActor) => ShieldGrantResult>(
            // #418: the real closure returns the post-cap growth AND the gross attempt. This spy
            // caps nothing, so the two are equal — the assertions below read `mock.calls`, not
            // the return, so the shape only has to be a legal one.
            (raw) => ({ granted: raw, gross: raw })
        );
        const { ctx } = makeShieldCtx(grantSpy);
        executeIntent(intent, ctx);

        expect(grantSpy).toHaveBeenCalledTimes(1);
        const grantedRaw = grantSpy.mock.calls[0][0];
        // 0.50 × D = 1,500. PRE-FIX: triggerDamage is undefined / basis falls through to maxHp
        // → 0.50 × 50,000 = 25,000.
        expect(grantedRaw).toBeCloseTo(0.5 * D, 6);
        expect(grantedRaw).not.toBeCloseTo(0.5 * MAX_HP, 0);
    });
});
