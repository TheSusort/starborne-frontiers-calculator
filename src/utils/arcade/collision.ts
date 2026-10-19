import { JUMP_SECONDS, PICKUP_CATCH_ARC } from './constants';
import type { ObstacleKind, Pickup, PlayerAction, PlayerState } from './types';

/** How high a jump is, 0 on the ground to 1 at its peak: `sin(πt)` over the jump's progress `t`.
 *  The renderer draws the jump with this arc. */
export function jumpArc(actionTime: number): number {
    const t = 1 - actionTime / JUMP_SECONDS;
    return Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, t))));
}

/** wall: only a lane change avoids it. low: jump over. high: duck under. */
export function blocks(kind: ObstacleKind, action: PlayerAction): boolean {
    if (kind === 'wall') return true;
    if (kind === 'low') return action !== 'jump';
    return action !== 'duck';
}

/**
 * A pickup in the player's lane is collected unless a jump carries the ship clear over it: a
 * jump still passes through it while the arc is at most PICKUP_CATCH_ARC, which is just after
 * take-off and just before landing. An active magnet collects credits in the own and adjacent
 * lanes at any height; it never reaches power-ups.
 */
export function canCollect(pickup: Pickup, player: PlayerState): boolean {
    const magnet = pickup.kind === 'credit' && player.magnetTime > 0;
    if (magnet) return Math.abs(pickup.lane - player.lane) <= 1;
    if (pickup.lane !== player.lane) return false;
    return player.action !== 'jump' || jumpArc(player.actionTime) <= PICKUP_CATCH_ARC;
}
