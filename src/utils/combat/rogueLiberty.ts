import type { StatusEngine } from './statusEngine';
import { selfBuffNamesForOwners } from './triggers';

/**
 * `Rogue's Liberty` — "Ignores Taunt and Provoke." (constants/buffs.ts). Granted by Chimei's
 * charged skill to all allies for 2 turns.
 *
 * NAME-KEYED: this is a targeting-rule override, not a stat, so it has no `parsedEffects`
 * channel to ride. It ORs into the existing `CombatActor.ignoresForcedTargeting` flag at the
 * resolver's read sites, turning a static construction-time property into a dynamic one.
 *
 * Scope matches the static flag exactly: actor-wide while held (most of the nine ships that
 * carry the static flag state the clause on a specific cast, yet it is modelled actor-wide),
 * and it does NOT bypass Concentrate Fire — see state.ts's flag docs and positionalBinding's
 * CF-over-Taunt priority.
 */
export const ROGUES_LIBERTY = "Rogue's Liberty";

/**
 * True when the actor currently carries Rogue's Liberty.
 *
 * Reads the BROAD self-buff union (scheduled + timed + aura/accum), unlike the one-shot statuses
 * that must be narrowed to the single channel their consume call can spend: Rogue's Liberty is a
 * standing effect for its whole duration and is never consumed, so every channel that can hold it
 * is a legitimate source.
 */
export function holdsRoguesLiberty(statusEngine: StatusEngine, actorId: string): boolean {
    return selfBuffNamesForOwners(statusEngine, [actorId]).includes(ROGUES_LIBERTY);
}
