/**
 * Pre-fight stat-modifier layer — public entry point.
 *
 * `runPreFight` executes the given passes IN ORDER over both sides' units (F ordering:
 * squad-leader pass first, then — in PR F5 — the ship-passives pass computed from the
 * frozen post-leader snapshot). Passes mutate the units' by-reference `stats` in place.
 */
import type { PreFightPass, PreFightUnit } from './types';

export type {
    PreFightStatBlock,
    PreFightCombatModifiers,
    PreFightUnit,
    PreFightPass,
    SquadLeaderSelection,
} from './types';
export { emptyPreFightModifiers, hasAnyPreFightModifier } from './types';
export {
    squadLeaderPass,
    activeSquadLeaderEffects,
    squadLeaderEffectTargeting,
    isSquadLeaderEffectSimulated,
} from './squadLeaderPass';
export type { SquadLeaderEffectTargeting } from './squadLeaderPass';

/** Run the pre-fight passes in order over both sides' units. */
export function runPreFight(
    ctx: { player: PreFightUnit[]; enemy: PreFightUnit[] },
    passes: PreFightPass[]
): void {
    for (const pass of passes) pass(ctx);
}
