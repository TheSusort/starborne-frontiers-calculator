import type { CombatEventBus } from './events';
import { emitAttacked } from './emitAttacked';

/**
 * Emits per-victim `attacked` events for an AoE cast: one event per hit per
 * footprint victim, each carrying that victim's own damage / shieldWasHit, with
 * `isPrimaryTarget` set only on the selected target. Delegates to `emitAttacked`
 * per victim so the per-event conditional-spread shape stays identical to the
 * legacy focus-only emit. Direction-agnostic (caller supplies attacker/victim ids).
 */
export function emitPerVictimAttacked(args: {
    bus: CombatEventBus;
    round: number;
    attackerId: string;
    primaryId: string;
    hitOutcomes: boolean[];
    victims: Map<string, { damage: number; shieldWasHit: boolean }>;
}): void {
    for (const [victimId, sig] of args.victims) {
        emitAttacked({
            bus: args.bus,
            round: args.round,
            targetId: victimId,
            attackerId: args.attackerId,
            hitOutcomes: args.hitOutcomes,
            isPrimaryTarget: victimId === args.primaryId,
            shieldWasHit: sig.shieldWasHit,
            damage: sig.damage,
        });
    }
}
