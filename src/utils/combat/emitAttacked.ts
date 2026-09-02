import type { CombatEventBus } from './events';

/**
 * Emits one `attacked` event per hit (Combat: symmetric reactive emission). Direction-agnostic —
 * the caller supplies the victim/attacker ids, the per-hit crit list, and the pre-decided
 * focus-victim signals. Conditional spreads keep the emitted shape minimal (and identical to the
 * historical inline enemy-turn emit it replaces). DoT/bomb/detonation hits never call this — only
 * direct weapon hits emit `attacked`.
 */
export function emitAttacked(args: {
    bus: CombatEventBus;
    round: number;
    targetId: string;
    attackerId: string;
    /** one entry per hit; `true` = that hit critted. */
    hitOutcomes: boolean[];
    isPrimaryTarget: boolean;
    shieldWasHit: boolean;
    /**
     * The damage this victim took from the ONE attack these events belong to (Tenacity's
     * >25%-maxHP gate reads it).
     *
     * On the positional path the engine groups its signals by SUB-ATTACK and calls this once per
     * sub-attack, so for a `hits: N` cast this is that sub-attack's slice, not the victim's
     * cast-wide aggregate — which is what a gate phrased "in one hit" must read. N=1 is the same
     * either way, and the non-positional call sites pass one attack per call.
     */
    damage: number;
    /**
     * Which sub-attack of the attacker's cast these events belong to.
     * Carried on the event so a victim-side once-per-attack rider guard can reset between the
     * attacker's consecutive attacks instead of collapsing all N into one grant.
     *
     * Supplied by the POSITIONAL callers, where the engine has already grouped signals by
     * sub-attack and `hitOutcomes` therefore holds exactly one entry per call. OMITTED by the
     * non-positional caller, which passes the whole cast's `hitOutcomes` in ONE call — there the
     * loop index below IS the sub-attack index (a `hits: N` cast is N consecutive attacks, R1), so
     * it is used as the fallback rather than leaving the field absent.
     */
    subAttackIndex?: number;
}): void {
    const {
        bus,
        round,
        targetId,
        attackerId,
        hitOutcomes,
        isPrimaryTarget,
        shieldWasHit,
        damage,
        subAttackIndex,
    } = args;
    hitOutcomes.forEach((hitCrit, hitIndex) => {
        bus.emit({
            type: 'attacked',
            targetId,
            attackerId,
            round,
            ...(isPrimaryTarget ? { isPrimaryTarget: true } : {}),
            ...(shieldWasHit ? { shieldWasHit: true } : {}),
            ...(hitCrit ? { didCrit: true } : {}),
            ...(damage > 0 ? { damage } : {}),
            subAttackIndex: subAttackIndex ?? hitIndex,
        });
    });
}
