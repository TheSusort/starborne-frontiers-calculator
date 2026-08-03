import type { StatusEngine } from './statusEngine';
import { selfBuffNamesForOwners } from './triggers';

/**
 * `Hit Mitigation` — "Blocks the next direct hit, transforming the damage receieved into dot
 * dealt over 3 rounds." (constants/buffs.ts; the typo is in the game data). Granted by
 * Oleander's charged skill to all allies for 3 turns.
 *
 * NAME-KEYED, like Exposed / Barrier / the Affinity Overrides, rather than a `parsedEffects`
 * entry: a one-shot block has no honest standing value, so folding it into an incoming channel
 * would leak permanent damage immunity into every non-consuming reader (effective-HP, the
 * DPS-mode aggregate scalars, the buff-display UI).
 *
 * Consumption follows the Exposed invariant — consume only on a hit that actually READ the
 * block. A Barrier-nullified hit and a hit already converted by the ability-based
 * `transform-incoming-to-dot` step (Voron/Orel) must both leave the status intact.
 */
export const HIT_MITIGATION = 'Hit Mitigation';

/**
 * Rounds the blocked hit is spread over. Fixed by the buff description, deliberately NOT read
 * from the status's own duration — both happen to be 3 today, and coupling them would be a
 * coincidence-shaped bug.
 */
export const HIT_MITIGATION_DOT_ROUNDS = 3;

/** True when the actor currently carries Hit Mitigation. */
export function holdsHitMitigation(statusEngine: StatusEngine, actorId: string): boolean {
    return selfBuffNamesForOwners(statusEngine, [actorId]).includes(HIT_MITIGATION);
}

/**
 * Consume the holder's Hit Mitigation after it blocks a direct hit. Targets the per-actor
 * self-buff store, mirroring the Affinity Overrides' name-keyed reads in playerTurn. A no-op
 * when the actor carries none, so it is safe to call on any hit.
 *
 * NOT consumable: a Hit Mitigation arriving as an ALWAYS-ACTIVE scheduled buff (manually selected
 * in the calculator's buff picker with no turn count), which lives in the status engine's
 * `alwaysSelf` set rather than a per-actor map — so a manual selection blocks every direct hit
 * instead of one. The same pre-existing limitation of the manual-buff model already makes a
 * manually selected Barrier permanently invulnerable and a manually selected Exposed permanently
 * amplified; it is not specific to Hit Mitigation. Oleander's real grant is a TIMED ability status,
 * which this clears correctly.
 */
export function consumeHitMitigation(statusEngine: StatusEngine, actorId: string): void {
    statusEngine.removeSelfBuffByName(actorId, HIT_MITIGATION);
}
