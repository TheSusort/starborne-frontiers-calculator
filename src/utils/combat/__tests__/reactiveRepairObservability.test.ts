/**
 * #434 Task 1 — `reactive-heal-performed` carries the per-target clipped excess and the id of
 * the ability that produced it.
 *
 * The overheal figure is what an `overheal`-basis reaction (Abundant Renewal, and #435's
 * redirect) scales from; without it the event cannot drive one. `sourceAbilityId` is the
 * re-entrancy guard's key — see the termination proof at the listener in Task 2.
 *
 * ⚠️ `sourceAbilityId` is an in-memory routing key. It must never reach a golden or a
 * combat-log row: `nextId()` runs off a module-level counter that is never reset, so the same
 * ability gets a different id depending on how many kits were built before it.
 */
import { describe, it, expect } from 'vitest';
import { executeIntent, Intent, IntentExecContext, ReactiveAbility } from '../triggers';
import { createEventBus, CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import type { Ability } from '../../../types/abilities';

const OWNER_ID = 'medic';
const ALLY_ID = 'ally';
const MAX_HP = 50_000;

// A reactive ally repair. `raw` will be 10% of 50,000 = 5,000; the harness clips 4,000 of it.
const reactiveAllyRepair = (): Ability => ({
    id: 'ab-repair',
    type: 'heal',
    target: 'ally',
    trigger: 'start-of-round',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'hp' },
});

function runReactiveRepair(): Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] {
    const bus = createEventBus();
    const emitted: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('reactive-heal-performed', (e) => emitted.push(e));

    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    const healing = {
        targetId: ALLY_ID,
        credit: () => {},
        creditRecipient: () => {},
        creditPerformed: () => {},
        perRecipientApply: true,
        // 5,000 raw arrives; 1,000 is consumed and 4,000 is clipped.
        applyHealToTarget: () => ({ reversed: false as const, consumed: 1_000, overheal: 4_000 }),
        grantShieldToTarget: () => ({ applied: 0, overshield: 0 }),
        recipientMaxHp: () => MAX_HP,
        recipientIncomingHealPct: () => 0,
        recipientActor: (id: string) =>
            id === ALLY_ID ? ({ id: ALLY_ID } as unknown as CombatActor) : undefined,
    } as unknown as IntentExecContext['healing'];

    const intent: Intent = {
        ownerId: OWNER_ID,
        ability: reactiveAllyRepair(),
        sourceSlot: 'passive',
    } as unknown as Intent;

    const ctx = {
        bus,
        round: 1,
        statusEngine: se,
        healing,
        // The brief's harness (mirroring `reactiveOverhealShield.test.ts`'s `makeShieldCtx`) omits
        // these, but `executeIntent` dereferences them unconditionally in `buildDrainContext`
        // (corrosion/inferno/bomb counts) and in the heal branch (`lastTurnCtxByActor.get`) before
        // ever reaching the heal config — an empty/absent value here throws, not fails an
        // assertion. Copied across from `makeShieldCtx` rather than loosening the cast further.
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        lastTurnCtxByActor: new Map(),
        // The owner's own runtime entry: `executeIntent` throws if `runtimes.get(ownerId)` misses,
        // and the heal fold reads `owner.actor.destroyedRound`, `owner.hp` (the 'hp'-basis fallback
        // this ability's config uses), and `owner.healModifier`.
        runtimes: new Map([
            [
                OWNER_ID,
                {
                    actor: { id: OWNER_ID, currentHp: MAX_HP } as unknown as CombatActor,
                    attack: 0,
                    defence: 0,
                    hp: MAX_HP,
                    healModifier: 0,
                } as never,
            ],
        ]),
        playerIds: [OWNER_ID, ALLY_ID],
        lowestHpAllyIdFor: () => ALLY_ID,
    } as unknown as IntentExecContext;

    executeIntent(intent, ctx);
    return emitted;
}

describe('#434 Task 1 — reactive-heal-performed payload', () => {
    it('carries the per-target clipped excess', () => {
        const [e] = runReactiveRepair();
        expect(e).toBeDefined();
        expect(e.perTarget).toEqual([{ targetId: ALLY_ID, amount: 5_000, overheal: 4_000 }]);
    });

    it('stamps the id of the ability that produced it', () => {
        const [e] = runReactiveRepair();
        expect(e.sourceAbilityId).toBe('ab-repair');
    });
});
