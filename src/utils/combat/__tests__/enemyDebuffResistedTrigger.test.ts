/**
 * #413 — the `on-enemy-debuff-resisted` LISTENER, driven directly through
 * `registerReactiveListeners` (the harness `reactiveDamageTakenShield.test.ts` established).
 *
 * The engine-level arms live in `xcellenceOnResistShieldDamage.integration.test.ts`. This file
 * exists for the two gate conditions that file cannot reach end-to-end:
 *
 *  - The SIDE gate on its rejecting arm. Every integration fixture has the resister on the
 *    opposing side by construction, so nothing there would notice if `isOpposing` were dropped.
 *  - The Block-Debuff auto-resist cause. NO ship in `docs/ship-skills.csv` grants Block Debuff,
 *    so it is unreachable from skill text and therefore from `simulateBattle` — the only way in is
 *    a hand-built kit. The listener sees exactly what a Block-Debuff resist would deliver, namely a
 *    `debuff-resisted` with no `viaLandingRoll`, so testing the gate on the ABSENT flag covers both
 *    no-roll causes at the one place the rule is actually written. (The affinity-disadvantage
 *    cause IS reachable end-to-end and is covered in the integration file, which is what proves
 *    the flag is really stamped `false` on a real no-roll path rather than merely honoured here.)
 */
import { describe, it, expect } from 'vitest';
import { createEventBus } from '../events';
import { registerReactiveListeners, type Intent, type ReactiveAbility } from '../triggers';
import type { Ability } from '../../../types/abilities';

const OWNER_ID = 'xcellence';

/** Xcellence's parsed shape: reactive shield-basis damage on `on-enemy-debuff-resisted`. */
const onEnemyResistDamage = (): Ability => ({
    id: 'xcellence-on-resist',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-enemy-debuff-resisted',
    conditions: [],
    config: { type: 'damage', multiplier: 0, hits: 1, shieldBasisPct: 115 },
});

/** Emits one `debuff-resisted` and returns whatever the listener enqueued. `enemy*` ids are
 *  opposing; anything else is same-side. */
function intentsFor(event: {
    sourceId?: string;
    targetId: string;
    viaLandingRoll?: true;
    subAttackIndex?: number;
}): Intent[] {
    const bus = createEventBus();
    const ra: ReactiveAbility = { ability: onEnemyResistDamage(), sourceSlot: 'passive' };
    const intents: Intent[] = [];
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: OWNER_ID, reactiveAbilities: [ra] }],
        enqueue: (i) => intents.push(i),
        isOpposing: (id) => id.startsWith('enemy'),
    });
    bus.emit({ type: 'debuff-resisted', round: 1, buffName: 'Speed Down II', ...event });
    return intents;
}

describe('#413 — on-enemy-debuff-resisted listener', () => {
    it('fires on an OPPOSING resister and routes the RESISTER as the retaliation target', () => {
        const intents = intentsFor({
            sourceId: 'ally',
            targetId: 'enemy1',
            viaLandingRoll: true,
        });
        expect(intents).toHaveLength(1);
        // The damage hits the enemy that resisted (owner ruling) — NOT the inflictor, which is
        // where the resister-scoped sibling `on-debuff-resisted` routes.
        expect(intents[0].eventCtx?.counterTargetId).toBe('enemy1');
    });

    it('is INFLICTOR-AGNOSTIC: an ally’s debuff and the owner’s own both fire it', () => {
        // The whole bug. `on-own-debuff-resisted` dropped the first of these two.
        expect(
            intentsFor({ sourceId: 'ally', targetId: 'enemy1', viaLandingRoll: true })
        ).toHaveLength(1);
        expect(
            intentsFor({ sourceId: OWNER_ID, targetId: 'enemy1', viaLandingRoll: true })
        ).toHaveLength(1);
        // ...and it does not even require a named inflictor.
        expect(intentsFor({ targetId: 'enemy1', viaLandingRoll: true })).toHaveLength(1);
    });

    it('does NOT fire when a SAME-SIDE unit resists (the owner’s own resist included)', () => {
        // "When an ENEMY resists". A same-side resist is Vindicator's `on-debuff-resisted` clause,
        // not this one. Unreachable in the integration fixtures, where every resister is opposing.
        expect(
            intentsFor({ sourceId: 'enemy1', targetId: 'ally', viaLandingRoll: true })
        ).toHaveLength(0);
        expect(
            intentsFor({ sourceId: 'enemy1', targetId: OWNER_ID, viaLandingRoll: true })
        ).toHaveLength(0);
    });

    it('does NOT fire when no landing roll was drawn', () => {
        // Both no-roll causes — Block Debuff and affinity disadvantage — arrive here as an absent
        // flag; the listener cannot and need not tell them apart.
        expect(intentsFor({ sourceId: 'ally', targetId: 'enemy1' })).toHaveLength(0);
    });

    it('carries the sub-attack identity through to the intent', () => {
        // The dedupe key downstream reads `eventCtx.subAttackIndex`; without this stamp it would
        // fall back to `'x'` and collapse two attacks in one turn into a single proc.
        expect(
            intentsFor({
                sourceId: 'ally',
                targetId: 'enemy1',
                viaLandingRoll: true,
                subAttackIndex: 2,
            }).at(0)?.eventCtx?.subAttackIndex
        ).toBe(2);
        // Absent on the event → absent on the intent, rather than defaulted to 0. A 0 default
        // would be indistinguishable from a real first sub-attack.
        expect(
            intentsFor({ sourceId: 'ally', targetId: 'enemy1', viaLandingRoll: true }).at(0)
                ?.eventCtx?.subAttackIndex
        ).toBeUndefined();
    });
});
