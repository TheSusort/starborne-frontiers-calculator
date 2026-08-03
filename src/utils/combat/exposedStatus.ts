import type { StatusEngine } from './statusEngine';

/**
 * `Exposed` — "Increases the incoming damage of the next direct hit by 100%, removed after taking
 * direct damage or at the end of the round." (constants/buffs.ts).
 *
 * NAME-KEYED, like Stealth / Barrier / the Affinity Overrides, rather than a `parsedEffects`
 * entry: the amount is not a standing modifier — it evaporates on the first direct hit — so
 * folding +100% into `parsedEffects.incomingDamage` would leak a permanent amplification into
 * every non-consuming reader of that channel (the DPS-mode aggregate scalars, effective-HP, the
 * buff-display UI). The engine instead reads the name at the per-victim incoming fold and consumes
 * the status in the shared per-victim damage funnel, so amplification and consumption stay in
 * lockstep on the same hit.
 *
 * Appliers in the corpus: Amartya's reactive "inflicts 2 stacks of Exposed on that defender"
 * (on-enemy-taunt-gained) and Nayra's charged skill.
 */
export const EXPOSED = 'Exposed';

/** Incoming-direct-damage amplification (percentage points) contributed by ONE Exposed stack. */
export const EXPOSED_INCOMING_PCT = 100;

/**
 * The incoming-damage amplification a victim's Exposed stacks contribute, in percentage points,
 * summed into the same per-victim `incomingDamageModifier` channel as Inc. Damage Up (engine's
 * `victimIncomingModifiers`).
 *
 * Stack scaling matches the repo-wide convention for status effects (`value * stacks`, see
 * dpsBuffHelpers' `toEnemyModifiers`): Amartya's 2 stacks amplify the next hit by 200%, consumed
 * together. OPEN GAME-RULE QUESTION: the alternative reading is that each stack arms its OWN hit
 * (2 stacks → two consecutive hits at +100%). The game text's single "removed after taking direct
 * damage" — not "removes one stack" — is what tips this to all-at-once; revisit if in-game
 * observation says otherwise.
 *
 * Reads the victim's TIMED per-victim enemy store directly rather than the caller's assembled
 * three-channel debuff list, because that is exactly the channel {@link consumeExposed} can delete
 * — amplify and consume must see the same set or the status stops being one-shot. The dropped
 * channels are the SCHEDULED store (keyed to the global `__enemy__` sentinel, so a per-victim
 * removal can never reach it) and the aura/accumulating ability channel (`recurring`, living in
 * maps `removeTimedEnemyStatus` never visits). A manually selected DPS-mode `Exposed` arrives
 * always-active on the scheduled channel and used to amplify EVERY direct hit of the battle by
 * +100%, which contradicts the status's own text; it is now INERT instead — the faithful rendering,
 * since "the next direct hit" has no standing value to model, the same reason the status is
 * name-keyed rather than a `parsedEffects` entry. Both corpus appliers (Amartya's reaction,
 * Nayra's cast) land on the timed channel via `applyTimedAbilityStatus`, so nothing real is lost.
 *
 * (`timedAbilityStatuses` also surfaces the persistent-stacking store, which the removal likewise
 * cannot reach — unreachable for Exposed, which is not a `PERSISTENT_STACKING_BUFFS` member and so
 * is never routed there.)
 */
export function exposedIncomingPct(statusEngine: StatusEngine, victimId: string): number {
    return statusEngine
        .timedAbilityStatuses('enemy', undefined, victimId)
        .reduce(
            (sum, s) =>
                s.active.buffName === EXPOSED
                    ? sum + EXPOSED_INCOMING_PCT * (s.payload.stacks ?? 1)
                    : sum,
            0
        );
}

/**
 * Consume the victim's Exposed after a direct hit ("removed after taking direct damage").
 *
 * Targets the per-victim enemy-side store `applyTimedAbilityStatus` writes — the channel both
 * corpus appliers land in — mirroring the §4.5 direct-damage Stasis break's use of the same
 * targeted API. A no-op when the victim carries no Exposed, so it is safe to call on every hit.
 *
 * The governing rule is "consume on a hit that actually READ the amplification", which splits the
 * two damage-cancelling mechanics apart:
 *  - a TRANSFORM (Voron/Orel's `transform-incoming-to-dot`, or the `Hit Mitigation` one-shot) only
 *    DEFERS the hit. The engine amplifies UPSTREAM of the damage funnel, so the amount converted
 *    into the DoT already carries the +100% — it lands, just over time. Exposed IS consumed.
 *  - `Barrier` ANNIHILATES the hit. Nothing lands at all, so the amplification is never cashed and
 *    Exposed survives for the next hit.
 * Not consumed either, for the same reason as Barrier: a hit whose whole amount an incoming-block
 * channel erased, and the three secondary hit types (reflect / counter / Protection-transfer),
 * none of which folds the per-victim incoming channel Exposed rides. See the guard in
 * `applyVictimDamage` for the full exclusion list.
 *
 * The SCHEDULED channel (a manually selected DPS-mode debuff, keyed to the global `__enemy__`
 * store) has no per-victim entry to delete, so this can never reach it. Rather than leave that as a
 * silent asymmetry, {@link exposedIncomingPct} does not READ that channel either — see its doc.
 */
export function consumeExposed(statusEngine: StatusEngine, victimId: string): void {
    statusEngine.removeTimedEnemyStatus(victimId, EXPOSED);
}
