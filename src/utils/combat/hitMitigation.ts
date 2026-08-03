import type { StatusEngine } from './statusEngine';

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
 * block. A Barrier-nullified hit, a bomb/detonation portion (which the funnel does not count as a
 * direct hit: `byDirectDamage === true && bombPortion === 0` is the engine's own `isDirect`), and a
 * hit already converted by the ability-based `transform-incoming-to-dot` step (Voron/Orel) must all
 * leave the status intact.
 */
export const HIT_MITIGATION = 'Hit Mitigation';

/**
 * Rounds the blocked hit is spread over. Fixed by the buff description, deliberately NOT read
 * from the status's own duration — both happen to be 3 today, and coupling them would be a
 * coincidence-shaped bug.
 */
export const HIT_MITIGATION_DOT_ROUNDS = 3;

/**
 * True when the actor carries a Hit Mitigation that {@link consumeHitMitigation} can actually
 * SPEND.
 *
 * Deliberately NOT `selfBuffNamesForOwners`, the broad three-channel name union every standing
 * name-keyed buff (Barrier, Stealth, the Affinity Overrides) reads. That union also surfaces
 * SCHEDULED self-buffs — and `removeSelfBuffByName` cannot reach the always-active ones: they live
 * in the status engine's `alwaysSelf` list and are re-injected into every `snapshot('attacker')` as
 * `turnsRemaining: 'recurring'`, not stored in a per-actor map there is anything to delete from.
 * Since `Hit Mitigation` is selectable in the calculator's buff picker (which emits no turn count),
 * reading that channel made a manual selection an UNSPENDABLE block: every direct hit converted
 * forever, and — because each conversion reports `transformedToDot > 0` — the holder's `attacked`
 * signal was suppressed for the whole battle, silently disabling its on-attacked reactives.
 *
 * A standing buff can honestly be always-active; a ONE-SHOT cannot. So the read is narrowed to the
 * timed + persistent ability-status channel, which is exactly what `removeSelfBuffByName` clears,
 * and a manual selection becomes INERT instead. Inert is the faithful rendering: there is no
 * standing value for "blocks the next hit", which is the same reason the status is name-keyed
 * rather than a `parsedEffects` entry.
 *
 * Excluded for the same reason: the aura/accumulating channel (`activeAbilityStatuses`). An aura
 * is `recurring` and lives in `auraSelfMaps`, which `removeSelfBuffByName` never visits; an
 * accumulating entry is only zeroed for the round and `beginRound` resumes its accrual. Both would
 * reintroduce an unspendable block. Every corpus grant is timed (Oleander's charged skill,
 * `all-allies` for 3 turns → `applyTimedAbilityStatus`), so nothing real is lost — and if a future
 * grant ever parses to a duration-less aura, this step going quiet is the correct signal that the
 * grant, not the read, needs fixing.
 */
export function holdsHitMitigation(statusEngine: StatusEngine, actorId: string): boolean {
    return statusEngine
        .timedAbilityStatuses('self', actorId)
        .some((s) => s.active.buffName === HIT_MITIGATION);
}

/**
 * Consume the holder's Hit Mitigation after it blocks a direct hit. Clears all three of the
 * actor's own self stores (timed / accumulating / persistent), so it is the exact counterpart of
 * {@link holdsHitMitigation}'s narrowed read — every channel that read can see, this can spend.
 * A no-op when the actor carries none, so it is safe to call on any hit.
 */
export function consumeHitMitigation(statusEngine: StatusEngine, actorId: string): void {
    statusEngine.removeSelfBuffByName(actorId, HIT_MITIGATION);
}
