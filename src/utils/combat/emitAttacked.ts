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
    /** per-attack aggregate dealt to the focus victim (Tenacity's >25%-maxHP gate reads this). */
    damage: number;
}): void {
    const { bus, round, targetId, attackerId, hitOutcomes, isPrimaryTarget, shieldWasHit, damage } =
        args;
    for (const hitCrit of hitOutcomes) {
        bus.emit({
            type: 'attacked',
            targetId,
            attackerId,
            round,
            ...(isPrimaryTarget ? { isPrimaryTarget: true } : {}),
            ...(shieldWasHit ? { shieldWasHit: true } : {}),
            ...(hitCrit ? { didCrit: true } : {}),
            ...(damage > 0 ? { damage } : {}),
        });
    }
}
