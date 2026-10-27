import { DROP_SECONDS, JUMP_SECONDS, PICKUP_CATCH_ARC } from './constants';
import type { ObstacleKind, Pickup, PlayerAction, PlayerState } from './types';

/** How far through an action of `seconds` the player is, 0..1, from its `actionTime` left. */
export const actionProgress = (actionTime: number, seconds: number): number =>
    Math.min(1, Math.max(0, 1 - actionTime / seconds));

/** How high a jump is, 0 on the ground to 1 at its peak: `sin(πt)` over the jump's progress `t`.
 *  The renderer draws the jump with this arc. */
export function jumpArc(actionTime: number): number {
    return Math.max(0, Math.sin(Math.PI * actionProgress(actionTime, JUMP_SECONDS)));
}

/** How high the ship is, on the jump's 0..1 scale: the jump's arc, or during a drop a straight
 *  fall from the arc the jump had at the cancel (`dropArc`) to the ground. */
export function liftArc(player: PlayerState): number {
    if (player.action === 'jump') return jumpArc(player.actionTime);
    if (player.action === 'drop') {
        return player.dropArc * Math.min(1, Math.max(0, player.actionTime / DROP_SECONDS));
    }
    return 0;
}

/** wall: only a lane change avoids it. low: jump over. high: duck under. A drop clears nothing. */
export function blocks(kind: ObstacleKind, action: PlayerAction): boolean {
    if (kind === 'wall') return true;
    if (kind === 'low') return action !== 'jump';
    return action !== 'duck';
}

/**
 * A pickup in the player's lane is collected unless a jump or a drop carries the ship clear over
 * it: the ship still passes through it while `liftArc` is at most PICKUP_CATCH_ARC, which is just
 * after take-off and just before landing. An active magnet collects credits in the own and adjacent
 * lanes at any height; it never reaches power-ups.
 */
export function canCollect(pickup: Pickup, player: PlayerState): boolean {
    const magnet = pickup.kind === 'credit' && player.magnetTime > 0;
    if (magnet) return Math.abs(pickup.lane - player.lane) <= 1;
    if (pickup.lane !== player.lane) return false;
    return liftArc(player) <= PICKUP_CATCH_ARC;
}
