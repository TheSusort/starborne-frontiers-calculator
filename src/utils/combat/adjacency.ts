import { neighbors } from '../targeting/board';
import type { Position } from '../../types/encounters';

/** Minimal shape this helper needs from a combat actor. CombatActor satisfies it. */
interface AdjacencyActor {
    id: string;
    position?: Position;
    destroyedRound?: number;
}

/**
 * Resolve the recipient id list for an `adjacent-allies` grant.
 *
 * Positional (the owner AND at least one OTHER actor carry a board position):
 *   living same-side actors whose position is a hex-neighbour of the owner's, owner excluded.
 * Non-positional (no board positions wired — every current production path):
 *   all living same-side actors, owner excluded (the all-allies fallback, per spec §3.3).
 *
 * "Living" = `destroyedRound === undefined` (engine's canonical destroyed signal).
 */
export function adjacentAllyIds(ownerId: string, actors: AdjacencyActor[]): string[] {
    const owner = actors.find((x) => x.id === ownerId);
    // Wave 5 hardening: if the anchor isn't in this roster at all, it has no neighbours here —
    // return [] rather than falling through to the whole-roster fallback below. Every current
    // `adjacent-allies` caller queries the owner's OWN side, where the owner is always present,
    // so this guard is inert on the existing corpus; it only protects a future wrong-roster call.
    if (owner === undefined) return [];
    const living = actors.filter((x) => x.destroyedRound === undefined && x.id !== ownerId);
    const anyOtherPositioned = actors.some((x) => x.id !== ownerId && x.position != null);
    if (owner.position != null && anyOtherPositioned) {
        const nbrs = new Set<Position>(neighbors(owner.position));
        return living.filter((x) => x.position != null && nbrs.has(x.position)).map((x) => x.id);
    }
    return living.map((x) => x.id);
}
