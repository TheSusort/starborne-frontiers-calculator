import type { ObstacleKind, Pickup, PlayerAction, PlayerState } from './types';

/** wall: only a lane change avoids it. low: jump over. high: duck under. */
export function blocks(kind: ObstacleKind, action: PlayerAction): boolean {
    if (kind === 'wall') return true;
    if (kind === 'low') return action !== 'jump';
    return action !== 'duck';
}

/**
 * Jumping flies over pickups, so a jumping player collects nothing unless a magnet is active,
 * and then only credits. A magnet reaches credits in the own and adjacent lanes; power-ups
 * need the own lane and a non-jumping player.
 */
export function canCollect(pickup: Pickup, player: PlayerState): boolean {
    const magnet = pickup.kind === 'credit' && player.magnetTime > 0;
    if (player.action === 'jump' && !magnet) return false;
    if (pickup.lane === player.lane) return true;
    return magnet && Math.abs(pickup.lane - player.lane) === 1;
}
