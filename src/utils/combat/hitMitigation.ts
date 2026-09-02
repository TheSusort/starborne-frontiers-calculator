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
 * Deliberately NOT `selfBuffNamesForOwners`, the broad three-channel name union the other
 * name-keyed statuses read. That union also surfaces SCHEDULED self-buffs — and
 * `removeSelfBuffByName` cannot reach the always-active ones: they live in the status engine's
 * `alwaysSelf` list and are re-injected into every `snapshot('attacker')` as
 * `turnsRemaining: 'recurring'`, not stored in a per-actor map there is anything to delete from.
 * Since `Hit Mitigation` is selectable in the calculator's buff picker (which emits no turn count),
 * reading that channel made a manual selection an UNSPENDABLE block: every direct hit converted
 * forever, and — because each conversion reports `transformedToDot > 0` — the holder's `attacked`
 * signal was suppressed for the whole battle, silently disabling its on-attacked reactives.
 *
 * A standing buff can honestly be always-active; a ONE-SHOT cannot. So the read is narrowed to the
 * timed + persistent ability-status channel — a SUBSET of what `removeSelfBuffByName` clears, not an
 * exact match (see below) — and a manual selection becomes INERT instead. Inert is the faithful
 * rendering: there is no standing value for "blocks the next hit", which is the same reason the
 * status is name-keyed rather than a `parsedEffects` entry.
 *
 * The statuses that DO read the broad union split into two categories, and only one of them is a
 * precedent worth copying. Barrier and Stealth are genuinely STANDING, so the broad read is correct
 * for them. The Affinity Overrides are not: they are ONE-SHOT by game text ("removed after
 * attacking" / "removed after being attacked") yet have NO `removeSelfBuffByName` call anywhere in
 * `src` — the same defect this module fixes, still open, backlogged pending a game-rule decision
 * on what "removed after attacking" should mean for a manually selected one. So cite
 * Barrier/Stealth as the pattern; the Overrides are an instance of the bug, not of the design.
 *
 * The one sub-channel deliberately dropped in the TIGHTENING direction: a SCHEDULED self-buff that
 * DOES carry a turn count is written into the same `selfMaps` this read walks, but with no
 * `payload` (statusEngine's scheduled `upsertBuff`), and `timedAbilityStatuses` skips payload-less
 * entries — whereas `removeSelfBuffByName` deletes by family key regardless of payload and so could
 * have spent it. A scheduled TIMED Hit Mitigation is therefore inert.
 *
 * WHY IT IS UNREACHABLE — and NOT for the reason it looks like. A reachability argument phrased
 * over which callers supply `enemyAttackers` proves nothing: EVERY caller supplies a roster, so
 * that qualifier narrows nothing. The real premise never involved `enemyAttackers` at all:
 * `upsertBuff` — what `sourceFired` calls for every
 * entry in the SCHEDULED `selfBuffs`/`enemyDebuffs` input, manual picker picks and auto-filled
 * `SelectedGameBuff`s alike, on every caller — writes a `BuffState` with no `payload` field, full
 * stop (see its `map.set(familyKey, {...})` literal: buffName/turnsRemaining/tier/appliedSeq/
 * appliedThisTurn, nothing else). `timedAbilityStatuses`, the only thing this function reads,
 * unconditionally skips payload-less entries (`if (!s.payload) continue;`) — that filter isn't
 * gated by caller, mode, or `enemyAttackers`, so no scheduled-channel entry can ever be visible
 * here, regardless of who writes it or what it's paired with. `simulateDPS`'s Oleander scenario this
 * argument worried about is therefore inert on arrival, with no run needed to confirm it: as a
 * smaller correction to that scenario, DPSCalculatorPage's `attackerBuffs`/`enemyBuffs` (the
 * `selfBuffs`/`enemyDebuffs` it hands `simulateDPS`) are wired only to the manual `GameBuffPicker`
 * (`setAttackerBuffs`/`setEnemyBuffs`, via `onAttackerBuffsChange`/`onEnemyBuffsChange`) — nothing
 * auto-fills them there. `buildSkillBuffAutoFill` is used by `DefenseCalculatorPage`/
 * `SpeedCalculatorPage` directly, and separately by `buildShipAbilities`, which converts its output
 * into real `Ability` objects (`selectedBuffToAbility`) that register through the PAYLOAD-bearing
 * `applyTimedAbilityStatus` path below — not this scheduled one. Oleander's real charge-skill grant
 * already reaches the holder that way, which is exactly what hitMitigation.integration.test.ts
 * exercises. "Inert, accepted" above is CONFIRMED, not a hand-off.
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
 * Consume the holder's Hit Mitigation after it blocks a direct hit. Clears all three of the actor's
 * own self stores (timed / accumulating / persistent), which STRICTLY CONTAINS what
 * {@link holdsHitMitigation} reads — every channel that read can see, this can spend, which is the
 * invariant that makes the status a genuine one-shot. (The containment is deliberately not an
 * equality; see that function's doc for the one sub-channel this can spend but the read ignores.)
 * A no-op when the actor carries none, so it is safe to call on any hit.
 */
export function consumeHitMitigation(statusEngine: StatusEngine, actorId: string): void {
    statusEngine.removeSelfBuffByName(actorId, HIT_MITIGATION);
}
