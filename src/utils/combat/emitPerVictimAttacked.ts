import type { CombatEventBus } from './events';
import { emitAttacked } from './emitAttacked';

/**
 * Emits per-victim `attacked` events for ONE attack's AoE footprint: one event
 * per hit per footprint victim, each carrying that victim's OWN damage /
 * shieldWasHit / hitOutcomes, with `isPrimaryTarget` set only on the selected
 * target. Delegates to `emitAttacked` per victim so the per-event
 * conditional-spread shape stays identical to the legacy focus-only emit.
 * Direction-agnostic (caller supplies attacker/victim ids).
 *
 * The engine calls this once per SUB-ATTACK, so
 * `victims` is one sub-attack's footprint and each signal carries exactly one
 * `hitOutcomes` entry. The drop-out story therefore lives in the engine's outer
 * sub-attack map, not here: a victim killed on an earlier sub-attack simply has
 * no entry in the later sub-attacks' maps, so it collects fewer `attacked`
 * events than the cast's hit count — no over-firing of its on-hit reactives.
 * Total `attacked` cardinality across the cast is unchanged by the regrouping.
 */
export function emitPerVictimAttacked(args: {
    bus: CombatEventBus;
    round: number;
    attackerId: string;
    primaryId: string;
    victims: Map<string, { damage: number; shieldWasHit: boolean; hitOutcomes: boolean[] }>;
    /** The sub-attack `victims` belongs to — stamped onto every event it emits. */
    subAttackIndex?: number;
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
            ...(args.subAttackIndex !== undefined ? { subAttackIndex: args.subAttackIndex } : {}),
        });
    }
}
