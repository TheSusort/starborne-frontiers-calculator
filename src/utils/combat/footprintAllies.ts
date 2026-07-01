import type { Position } from '../../types/encounters';
import type { ParsedPattern } from '../targetingParser';
import { resolveCells } from '../targeting/resolvePattern';
import type { CombatActor } from './state';

/**
 * Living same-side allies occupying cells in a friendly support pattern footprint.
 *
 * PURE helper — mirror of {@link footprintVictims} for ally-targeted grants/heals/shields/buffs.
 * Empty cells contribute nothing; dead or unpositioned actors are never returned.
 */
export function footprintAllies(args: {
    pattern: ParsedPattern;
    anchor: Position;
    sameSideLiving: CombatActor[];
}): CombatActor[] {
    const byCell = new Map<Position, CombatActor>();
    for (const a of args.sameSideLiving) {
        if (a.position !== undefined && a.currentHp > 0) {
            byCell.set(a.position, a);
        }
    }

    const hits: CombatActor[] = [];
    for (const { position } of resolveCells(args.pattern, args.anchor)) {
        const ally = byCell.get(position);
        if (ally) hits.push(ally);
    }
    return hits;
}
