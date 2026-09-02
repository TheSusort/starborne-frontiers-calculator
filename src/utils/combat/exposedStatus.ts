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
 * dpsBuffHelpers' `toEnemyModifiers`): Amartya's 2 stacks amplify the next hit by 200%.
 *
 * SETTLED GAME RULE (owner ruling, 2026-08-10 — LOCKED): a hit READS ALL of the victim's stacks but
 * SPENDS EXACTLY ONE, so each stack arms its own hit. 2 stacks → +200% on the first hit, then
 * +100% on the second, then nothing. This function is the READ half; {@link consumeExposed} is
 * the SPEND half, and it spends one stack via the status engine's stack axis.
 * The live count arrives through `payload.stacks` because `timedAbilityStatuses`
 * spreads the entry's own live count over the shared registered payload — there is no second store
 * of stack counts to fall out of step with expiry or victim death.
 *
 * Reads the victim's TIMED per-victim enemy store directly rather than the caller's assembled
 * three-channel debuff list, because that is exactly the channel {@link consumeExposed} can spend
 * from — amplify and consume must see the same set or the status stops being one-shot. The dropped
 * channels are the SCHEDULED store (keyed to the global `__enemy__` sentinel, so a per-victim
 * removal can never reach it) and the aura/accumulating ability channel (`recurring`, living in
 * maps `consumeTimedEnemyStatusStack` never visits). A manually selected DPS-mode `Exposed` arrives
 * always-active on the scheduled channel and is therefore INERT — amplifying EVERY direct hit of
 * the battle by +100% would contradict the status's own text, and inertness is the faithful
 * rendering, since "the next direct hit" has no standing value to model, the same reason the status
 * is name-keyed rather than a `parsedEffects` entry. Both corpus appliers (Amartya's reaction,
 * Nayra's cast) land on the timed channel via `applyTimedAbilityStatus`, so nothing real is lost.
 *
 * (`timedAbilityStatuses` also surfaces the persistent-stacking store, which the stack spend
 * likewise cannot reach — unreachable for Exposed, which is not a `PERSISTENT_STACKING_BUFFS`
 * member and so is never routed there.)
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
 * Consume ONE of the victim's Exposed stacks after a direct hit ("removed after taking direct
 * damage"). The remaining stacks stay armed for the next hit — a hit reads every stack but spends
 * exactly one (owner ruling, 2026-08-10; see {@link exposedIncomingPct} for the read half).
 *
 * Targets the per-victim enemy-side store `applyTimedAbilityStatus` writes — the channel both
 * corpus appliers land in — mirroring the §4.5 direct-damage Stasis break's use of the same
 * targeted API, but on the STACKS axis (`consumeTimedEnemyStatusStack`) rather than the turns axis
 * that break uses. The entry is deleted only when its last stack goes. A no-op when the victim
 * carries no Exposed, so it is safe to call on every hit.
 *
 * WHAT THIS RULING DID NOT CHANGE: WHEN a stack is spent. Every consumption guard below stands
 * exactly as it was — this is about how much is spent, never about whether.
 *
 * The governing rule is a single premise — NOTHING LANDED AT THAT INSTANT — and it covers both of
 * the funnel's damage-cancelling mechanics identically (owner ruling, 2026-08-03):
 *  - `Barrier` ANNIHILATES the hit. Nothing lands at all, so the amplification is never cashed and
 *    Exposed survives for the next hit.
 *  - a TRANSFORM (Voron/Orel's `transform-incoming-to-dot`, or the `Hit Mitigation` one-shot)
 *    replaces the hit with a DoT, so nothing lands at that instant either — Exposed likewise
 *    survives, and a following real hit is still amplified.
 * The transform half is the same reading of the same value as the engine's `attacked` SUPPRESSION
 * for a fully converted hit (`fullyTransformedToDot`, in the per-victim `onVictimResolved` hook):
 * that hit is not a direct hit, so it neither raises the "directly damaged" signal nor spends a
 * status the game text ties to "taking direct damage". One premise, both consequences — the cross
 * reference exists because an earlier round briefly asserted the opposite premise here (a transform
 * only DEFERS, so the amplification was read) while the suppression kept this one, leaving the two
 * contradicting each other. If either is ever revisited, revisit both in the same commit.
 * Not consumed either, for the same reason: a hit whose whole amount an incoming-block channel
 * erased, and the three secondary hit types (reflect / counter / Protection-transfer), none of which
 * folds the per-victim incoming channel Exposed rides. See the guard in `applyVictimDamage` for the
 * full exclusion list.
 *
 * ACCEPTED CONSEQUENCE of the ruling: {@link exposedIncomingPct} is folded in UPSTREAM of the damage
 * funnel, so a transform converts the ALREADY-AMPLIFIED amount into its DoT while Exposed also
 * survives for a later hit — the +100% is effectively banked twice. Deliberate and accepted, not an
 * oversight: the only way to make it once-only would be to convert the UNAMPLIFIED amount, which
 * contradicts what a deferral is. Do not "fix" it.
 *
 * The SCHEDULED channel (a manually selected DPS-mode debuff, keyed to the global `__enemy__`
 * store) has no per-victim entry to delete, so this can never reach it. Rather than leave that as a
 * silent asymmetry, {@link exposedIncomingPct} does not READ that channel either — see its doc.
 */
export function consumeExposed(statusEngine: StatusEngine, victimId: string): void {
    statusEngine.consumeTimedEnemyStatusStack(victimId, EXPOSED);
}
