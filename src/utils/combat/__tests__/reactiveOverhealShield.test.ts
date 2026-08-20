/**
 * H3.3 — reactive `overheal` shield basis.
 *
 * A reactive `on-own-repair-to-ally` shield whose config basis is `overheal` (e.g. the Abundant
 * Renewal implant: "shield = X% of the over-repaired amount on the target when overrepairing an
 * ally") must scale off the CLIPPED EXCESS of the triggering repair (heal raw − HP actually
 * consumed), NOT the owner's Max HP.
 *
 * This test exercises BOTH halves of the H3.3 plumbing as one path:
 *   (a) the `on-own-repair-to-ally` listener threads the `heal-performed.overheal` into
 *       `eventCtx.overhealAmount`;
 *   (b) the heal/shield executor's `overheal` basis reads that `overhealAmount`.
 *
 * Step 1 drives the live listener (the same `registerReactiveListeners` + bus harness used by the
 * H3.1 damage-taken sibling) and emits a `heal-performed` event carrying a KNOWN overheal OH that
 * reached a non-self ally. The enqueued intent is captured. Step 2 feeds that intent through
 * `executeIntent` with a `grantShieldToTarget` spy and asserts the granted pool === 0.50 × OH and
 * that it lands on the OVER-REPAIRED ally (the heal target).
 *
 * PRE-FIX this fails twice over: the `heal-performed` payload carries no `overheal` (so the
 * listener can't thread it and `overhealAmount` is undefined), and even if it did the `overheal`
 * basis is not in the union and falls through to effectiveMaxHp — so the grant would be
 * 0.50 × maxHp (50,000 → 25,000), far larger than 0.50 × OH (4,000 → 2,000).
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
import type { Ability } from '../../../types/abilities';

const OWNER_ID = 'medic';
const ALLY_ID = 'ally'; // the over-repaired heal target
const OH = 4_000; // known overheal (clipped excess of the triggering repair)
const MAX_HP = 50_000; // deliberately far from 0.5×OH so a maxHp fall-through is unmistakable

// A reactive ally-shield that grants 50% of the OVER-REPAIRED amount when the owner overheals an
// ally. No procChance → always fires.
const overhealShield = (): Ability => ({
    id: 'abundant-renewal',
    type: 'shield',
    target: 'ally',
    trigger: 'on-own-repair-to-ally',
    conditions: [],
    config: { type: 'shield', pct: 50, basis: 'overheal' },
});

// Drive the live on-own-repair-to-ally listener and capture the enqueued intent. Mirrors the H3.1
// captureIntentForAttack harness.
function captureIntentForOverheal(overheal: number): Intent {
    const bus = createEventBus();
    const ra: ReactiveAbility = { ability: overhealShield(), sourceSlot: 'passive' };
    const intents: Intent[] = [];
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: OWNER_ID, reactiveAbilities: [ra] }],
        enqueue: (i) => intents.push(i),
        isOpposing: (id) => id === 'enemy',
    });
    // The owner repaired a non-self ally; the cast over-repaired by `overheal`.
    bus.emit({
        type: 'heal-performed',
        casterId: OWNER_ID,
        targets: [ALLY_ID],
        round: 1,
        amount: 10_000,
        overheal,
    });
    expect(intents).toHaveLength(1);
    return intents[0];
}

function makeShieldCtx(grantShieldToTarget: (raw: number, actor: CombatActor) => void): {
    ctx: IntentExecContext;
} {
    const bus = createEventBus();
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });

    const healing: IntentExecContext['healing'] = {
        // The heal target is the over-repaired ally — an 'ally'-target reactive falls back to
        // healing.targetId, so the shield must land on ALLY_ID.
        targetId: ALLY_ID,
        credit: () => {},
        applyHealToTarget: () => ({ consumed: 0, overheal: 0 }),
        grantShieldToTarget,
        recipientMaxHp: () => MAX_HP,
        recipientIncomingHealPct: () => 0,
        // resolve the over-repaired ally to a truthy actor so the grant fires.
        recipientActor: (id: string) =>
            id === ALLY_ID ? ({ id: ALLY_ID } as unknown as CombatActor) : undefined,
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
            [
                ALLY_ID,
                {
                    actor: {
                        id: ALLY_ID,
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
        playerIds: [OWNER_ID, ALLY_ID],
        lastTurnCtxByActor: new Map([
            [
                OWNER_ID,
                { effectiveAttack: 10000, affinityMult: 1, effectiveMaxHp: MAX_HP } as never,
            ],
        ]),
        enemyHp: 100000,
        recordResisted: () => {},
        healing,
    } as IntentExecContext;

    return { ctx };
}

describe('H3.3 — reactive overheal shield basis', () => {
    it('grants a shield of 50% of the OVER-REPAIRED amount (not 50% of Max HP) to the over-repaired ally', () => {
        // Step 1: the on-own-repair-to-ally listener must thread the overheal into eventCtx.
        const intent = captureIntentForOverheal(OH);
        expect(intent.eventCtx?.overhealAmount).toBe(OH);

        // Step 2: the executor's overheal basis reads overhealAmount and lands on the ally.
        const grantSpy = vi.fn<(raw: number, actor: CombatActor) => void>();
        const { ctx } = makeShieldCtx(grantSpy);
        executeIntent(intent, ctx);

        expect(grantSpy).toHaveBeenCalledTimes(1);
        const [grantedRaw, grantedActor] = grantSpy.mock.calls[0];
        // 0.50 × OH = 2,000. PRE-FIX: overhealAmount is undefined / basis falls through to maxHp
        // → 0.50 × 50,000 = 25,000.
        expect(grantedRaw).toBeCloseTo(0.5 * OH, 6);
        expect(grantedRaw).not.toBeCloseTo(0.5 * MAX_HP, 0);
        expect(grantedActor.id).toBe(ALLY_ID);
    });
});
