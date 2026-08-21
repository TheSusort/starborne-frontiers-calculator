/**
 * H3.7 — `on-shield-applied` listener + Resonating-Fury recipient routing.
 *
 * Wires the REACTION half of the shield-applied seam (H3.5 defined the event + trigger; H3.6
 * EMITS it once per cast keyed on the granter). An `on-shield-applied` reactive BUFF ability
 * owned by the granter must fan its grant out to the SHIELD RECIPIENTS of that cast — exactly
 * mirroring the `on-own-repair-to-ally` → `repairedAllyIds` precedent (Font of Power), where an
 * `ally`-target buff lands on the event-derived recipients rather than the owner/whole team.
 *
 * This proves BOTH halves as one path:
 *   (a) the `on-shield-applied` listener is granter-scoped (`e.granterId === ownerId`), skips
 *       empty-recipient events, and threads `e.recipientIds` into `eventCtx.shieldRecipientIds`;
 *   (b) the buff executor reads `shieldRecipientIds` (target `ally`/`all-allies`) and grants the
 *       buff to EXACTLY those recipients — NOT the granter (unless it was itself a recipient).
 *
 * Two scenarios:
 *   1. Single recipient: granter shields one ally → that ally gets the buff; the granter does NOT.
 *   2. Multi-recipient single roll: granter shields TWO allies in ONE cast (one `shield-applied`
 *      event listing both) → ONE enqueued intent → BOTH allies get the buff from that single event
 *      (the proc roll, when present, happens once per cast — here no procChance, always fires).
 *
 * PRE-FIX this fails: there is no `on-shield-applied` case in registerReactiveListeners (no intent
 * enqueued), and even with an enqueued intent the buff executor has no `shieldRecipientIds` hook so
 * an `ally`-target grant would fall back to the owner/playerIds rather than the shield recipients.
 */
import { describe, it, expect } from 'vitest';
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

const GRANTER_ID = 'granter';
const ALLY1_ID = 'ally1';
const ALLY2_ID = 'ally2';

// A reactive buff that grants a known buff to the shield recipients when the owner applies a
// shield. Target 'ally' routes to eventCtx.shieldRecipientIds (the Resonating-Fury token H3.8
// will use). No procChance → always fires (proc-gating is covered by reactiveBuffProcGate).
const resonatingFuryBuff = (): Ability =>
    ({
        id: 'resonating-fury',
        type: 'buff',
        target: 'ally',
        trigger: 'on-shield-applied',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Crit Power Up',
            stacks: 3,
            duration: 1,
            parsedEffects: {},
        },
    }) as unknown as Ability;

/**
 * Drive the live on-shield-applied listener and capture every enqueued intent. Mirrors the H3.3
 * captureIntentForOverheal harness — emits a `shield-applied` event listing `recipientIds` and
 * returns the intents the listener produced.
 */
function captureIntentsForShield(granterId: string, recipientIds: string[]): Intent[] {
    const bus = createEventBus();
    const ra: ReactiveAbility = { ability: resonatingFuryBuff(), sourceSlot: 'passive' };
    const intents: Intent[] = [];
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: GRANTER_ID, reactiveAbilities: [ra] }],
        enqueue: (i) => intents.push(i),
        isOpposing: (id) => id === 'enemy',
    });
    bus.emit({
        type: 'shield-applied',
        granterId,
        recipientIds,
        round: 1,
        amount: 5_000,
    });
    return intents;
}

/**
 * Minimal buff-branch IntentExecContext, modeled on reactiveBuffProcGate's makeCtx. Captures the
 * recipient ids that actually received the buff (buff-applied.actorId). The full same-side roster
 * is [GRANTER, ALLY1, ALLY2]; a correct shieldRecipientIds routing lands ONLY on the recipients.
 */
function makeBuffCtx(): IntentExecContext & { appliedActorIds: string[] } {
    const bus = createEventBus();
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    se.beginRound(1);

    const appliedActorIds: string[] = [];
    bus.on('buff-applied', (e) => {
        appliedActorIds.push(e.actorId);
    });

    const runtimeFor = (id: string) =>
        [
            id,
            {
                actor: { id, chargeCount: 0, charges: 0 } as unknown as CombatActor,
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
        ] as const;

    const ctx = {
        round: 1,
        statusEngine: se,
        bus,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([runtimeFor(GRANTER_ID), runtimeFor(ALLY1_ID), runtimeFor(ALLY2_ID)]),
        grantAllyCharges: () => {},
        grantExtraAction: () => {},
        playerIds: [GRANTER_ID, ALLY1_ID, ALLY2_ID],
        lastTurnCtxByActor: new Map([
            [GRANTER_ID, { effectiveAttack: 10000, affinityMult: 1 } as never],
        ]),
        recordResisted: () => {},
    } as unknown as IntentExecContext & { appliedActorIds: string[] };

    (ctx as unknown as Record<string, unknown>).appliedActorIds = appliedActorIds;
    return ctx;
}

describe('H3.7 — on-shield-applied reaction routes buff to shield recipients', () => {
    it('granter-scoped: ignores another granter, skips empty-recipient events', () => {
        // Wrong granter → no enqueue.
        expect(captureIntentsForShield('someone-else', [ALLY1_ID])).toHaveLength(0);
        // Right granter, empty recipients → no enqueue.
        expect(captureIntentsForShield(GRANTER_ID, [])).toHaveLength(0);
    });

    it('(1) single recipient: the shielded ally gets the buff; the granter does NOT', () => {
        // Step 1: the listener threads recipientIds into eventCtx.shieldRecipientIds.
        const intents = captureIntentsForShield(GRANTER_ID, [ALLY1_ID]);
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.shieldRecipientIds).toEqual([ALLY1_ID]);

        // Step 2: the buff executor routes the grant to that recipient (not the granter).
        const ctx = makeBuffCtx();
        executeIntent(intents[0], ctx);

        expect(ctx.appliedActorIds).toEqual([ALLY1_ID]);
        expect(ctx.appliedActorIds).not.toContain(GRANTER_ID);
    });

    it('(2) multi-recipient single roll: ONE cast event buffs BOTH recipients', () => {
        // ONE shield-applied event listing two recipients → exactly ONE enqueued intent
        // (one proc roll per cast), carrying both recipients.
        const intents = captureIntentsForShield(GRANTER_ID, [ALLY1_ID, ALLY2_ID]);
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.shieldRecipientIds).toEqual([ALLY1_ID, ALLY2_ID]);

        // Step 2: the single intent fans the buff out to BOTH recipients (and not the granter).
        const ctx = makeBuffCtx();
        executeIntent(intents[0], ctx);

        expect(ctx.appliedActorIds).toEqual([ALLY1_ID, ALLY2_ID]);
        expect(ctx.appliedActorIds).not.toContain(GRANTER_ID);
    });

    it('(3) granter as its own recipient: buff lands on the granter when it shielded itself', () => {
        // A self+ally shield cast lists the granter among recipientIds → the buff routes there too.
        const intents = captureIntentsForShield(GRANTER_ID, [GRANTER_ID, ALLY1_ID]);
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.shieldRecipientIds).toEqual([GRANTER_ID, ALLY1_ID]);

        const ctx = makeBuffCtx();
        executeIntent(intents[0], ctx);

        expect(ctx.appliedActorIds).toEqual([GRANTER_ID, ALLY1_ID]);
    });
});
