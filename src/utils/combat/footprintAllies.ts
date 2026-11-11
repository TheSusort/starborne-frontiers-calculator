import type { Position } from '../../types/encounters';
import type { ParsedPattern } from '../targetingParser';
import { resolveCells } from '../targeting/resolvePattern';
import type { CombatActor } from './state';
import { buildCellIndex } from './cellIndex';

/**
 * Living same-side allies occupying cells in a friendly support pattern footprint.
 *
 * PURE helper — mirror of {@link footprintVictims} for ally-targeted grants/heals/shields/buffs.
 * One entry per ally, in footprint order: a multi-hex ally under several footprint cells is
 * returned once. Empty cells contribute nothing; dead or unpositioned actors are never returned.
 */
export function footprintAllies(args: {
    pattern: ParsedPattern;
    anchor: Position;
    sameSideLiving: CombatActor[];
}): CombatActor[] {
    const byCell = buildCellIndex(args.sameSideLiving.filter((a) => a.currentHp > 0));

    const hits = new Set<CombatActor>();
    for (const { position } of resolveCells(args.pattern, args.anchor)) {
        const ally = byCell.get(position);
        if (ally) hits.add(ally);
    }
    return [...hits];
}
