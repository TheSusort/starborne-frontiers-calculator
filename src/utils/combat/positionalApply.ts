import type { Position } from '../../types/encounters';
import type { ParsedPattern } from '../targetingParser';
import { resolveCells, type CellRole } from '../targeting/resolvePattern';
import type { CombatActor } from './state';

/**
 * One footprint cell that landed on a living opposing actor.
 * `roleScale` is the per-cell damage multiplier: origin cells deal full damage
 * (1.0), covered/splash cells deal half (0.5).
 */
export interface FootprintHit {
    victim: CombatActor;
    /** origin → 1.0, covered (any non-origin role) → 0.5 */
    roleScale: number;
}

/** Per-cell damage scale keyed off the resolved CellRole. */
const roleScaleFor = (role: CellRole): number => (role === 'origin' ? 1.0 : 0.5);

/**
 * Expand a positional pattern footprint into the list of living victims it hits.
 *
 * PURE helper. Given a parsed pattern, the resolved anchor position, and the living
 * opposing roster, returns one {@link FootprintHit} per occupied footprint cell with
 * its role scale. Empty cells contribute nothing; dead actors are not in the roster
 * map and so are never hit.
 *
 * `not-self` patterns produce only non-origin (covered) cells — the scale is keyed off
 * the resolved `role`, never off whether the cell equals the anchor.
 */
export function footprintVictims(
    pattern: ParsedPattern,
    anchor: Position,
    opposingLiving: CombatActor[]
): FootprintHit[] {
    // Mirror positionalBinding.byCell: living, positioned actors, ≤1 per cell.
    const byCell = new Map<Position, CombatActor>();
    for (const a of opposingLiving) {
        if (a.position !== undefined && a.currentHp > 0) {
            byCell.set(a.position, a);
        }
    }

    const hits: FootprintHit[] = [];
    for (const { position, role } of resolveCells(pattern, anchor)) {
        const victim = byCell.get(position);
        if (!victim) continue; // empty cell: contributes nothing
        hits.push({ victim, roleScale: roleScaleFor(role) });
    }
    return hits;
}
