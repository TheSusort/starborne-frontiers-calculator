import { neighbors } from '../targeting/board';
import type { Position } from '../../types/encounters';
import { cellsOf } from './cellIndex';

/** Minimal shape this helper needs from a combat actor. CombatActor satisfies it. */
interface AdjacencyActor {
    id: string;
    position?: Position;
    footprint?: readonly Position[];
    destroyedRound?: number;
}

/**
 * Resolve the recipient id list for an `adjacent-allies` grant.
 *
 * Positional (the owner AND at least one OTHER actor carry a board position):
 *   living same-side actors with a cell that is a hex-neighbour of any of the owner's cells, owner
 *   excluded. A multi-hex unit (a bounty boss) is adjacent to every unit touching any of its hexes.
 * Non-positional (no board positions wired — every current production path):
 *   all living same-side actors, owner excluded (the all-allies fallback, per spec §3.3).
 *
 * "Living" = `destroyedRound === undefined` (engine's canonical destroyed signal).
 */
export function adjacentAllyIds(ownerId: string, actors: AdjacencyActor[]): string[] {
    const owner = actors.find((x) => x.id === ownerId);
    // If the anchor isn't in this roster at all it has no neighbours here — return [] rather
    // than falling through to the whole-roster fallback below. `adjacent-allies` callers query
    // the owner's OWN side, where the owner is always present; this guard protects against a
    // wrong-roster call.
    if (owner === undefined) return [];
    const living = actors.filter((x) => x.destroyedRound === undefined && x.id !== ownerId);
    const anyOtherPositioned = actors.some((x) => x.id !== ownerId && x.position != null);
    if (owner.position != null && anyOtherPositioned) {
        const ownerCells = cellsOf(owner);
        const nbrs = new Set<Position>(
            ownerCells.flatMap(neighbors).filter((c) => !ownerCells.includes(c))
        );
        return living.filter((x) => cellsOf(x).some((c) => nbrs.has(c))).map((x) => x.id);
    }
    return living.map((x) => x.id);
}
