import type { Position } from '../../types/encounters';
import type { ParsedPattern } from '../targetingParser';
import { footprintAllies } from './footprintAllies';
import type { CombatActor } from './state';

/**
 * Living ally ids on the firing skill's friendlyPage support pattern footprint.
 *
 * Returns `undefined` when footprint filtering should not apply (non-positional /
 * non-support pattern) so callers keep legacy team-wide behaviour.
 */
export function supportFootprintAllyIds(args: {
    pattern?: ParsedPattern;
    anchor?: Position;
    sameSideLiving: CombatActor[];
}): string[] | undefined {
    const { pattern, anchor, sameSideLiving } = args;
    if (!pattern?.modifiers.support || anchor === undefined) return undefined;
    return footprintAllies({ pattern, anchor, sameSideLiving }).map((a) => a.id);
}
