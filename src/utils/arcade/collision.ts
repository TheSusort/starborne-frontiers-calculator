import type { ObstacleKind, Pickup, PlayerAction, PlayerState } from './types';

/** wall: only a lane change avoids it. low: jump over. high: duck under. */
export function blocks(kind: ObstacleKind, action: PlayerAction): boolean {
    if (kind === 'wall') return true;
    if (kind === 'low') return action !== 'jump';
    return action !== 'duck';
}

/** The magnet reaches adjacent lanes for credits only; power-ups need your own lane. */
export function canCollect(pickup: Pickup, player: PlayerState): boolean {
    if (pickup.lane === player.lane) return true;
    return (
        pickup.kind === 'credit' &&
        player.magnetTime > 0 &&
        Math.abs(pickup.lane - player.lane) === 1
    );
}
