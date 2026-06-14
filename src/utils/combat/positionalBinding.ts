import { selectTargets } from '../targeting/selectTargets';
import type { Position } from '../../types/encounters';
import type { ParsedTarget } from '../targetingParser';
import type { CombatActor } from './state';

/**
 * Positional selection is active for an actor only when:
 *   1. the acting actor itself has a board position, AND
 *   2. at least one opposing (living) actor has a board position.
 *
 * When this returns false the caller should fall back to the legacy
 * index-based targeting.
 */
export function isPositional(
    actorPosition: Position | undefined,
    opposingLiving: CombatActor[]
): boolean {
    return !!actorPosition && opposingLiving.some((a) => a.position !== undefined);
}

/**
 * Resolve the positional target anchor to a single living CombatActor.
 *
 * Steps:
 *   1. Build a position→actor map from the living (currentHp > 0) opposing actors
 *      that have a board position. Invariant: at most one actor per cell.
 *   2. Call selectTargets to obtain the anchor cell.
 *   3. Look up and return the actor at that cell, or null if no valid target.
 *
 * Returns null when the opposing side has no living positioned actors, or when
 * selectTargets cannot find a target (empty side).
 */
export function resolvePositionalTarget(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[]
): CombatActor | null {
    const byCell = new Map<Position, CombatActor>();
    for (const a of opposingLiving) {
        if (a.position !== undefined && a.currentHp > 0) {
            byCell.set(a.position, a);
        }
    }

    if (byCell.size === 0) {
        return null;
    }

    const { anchor } = selectTargets(target, {
        casterPosition: actorPosition,
        enemyOccupied: [...byCell.keys()],
    });

    return anchor ? (byCell.get(anchor) ?? null) : null;
}
