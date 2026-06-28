import type { CombatEventBus } from './events';
import { emitAttacked } from './emitAttacked';

/**
 * Emits per-victim `attacked` events for an AoE cast: one event per hit per
 * footprint victim, each carrying that victim's OWN damage / shieldWasHit /
 * hitOutcomes, with `isPrimaryTarget` set only on the selected target. Delegates
 * to `emitAttacked` per victim so the per-event conditional-spread shape stays
 * identical to the legacy focus-only emit. Direction-agnostic (caller supplies
 * attacker/victim ids).
 *
 * Each victim carries its OWN `hitOutcomes` (one entry per hit the victim was
 * actually present for): a victim killed on an earlier hit drops out of later
 * hits, so it collects fewer outcomes than the attack-wide hit count and emits
 * exactly that many `attacked` events — no over-firing of its on-hit reactives.
 */
export function emitPerVictimAttacked(args: {
    bus: CombatEventBus;
    round: number;
    attackerId: string;
    primaryId: string;
    victims: Map<string, { damage: number; shieldWasHit: boolean; hitOutcomes: boolean[] }>;
}): void {
    for (const [victimId, sig] of args.victims) {
        emitAttacked({
            bus: args.bus,
            round: args.round,
            targetId: victimId,
            attackerId: args.attackerId,
            hitOutcomes: sig.hitOutcomes,
            isPrimaryTarget: victimId === args.primaryId,
            shieldWasHit: sig.shieldWasHit,
            damage: sig.damage,
        });
    }
}
