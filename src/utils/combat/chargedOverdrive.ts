import type { StatusEngine } from './statusEngine';

/**
 * `Charged Overdrive II` — "Grants the next Charged Skill activation 20% Defense Penetration"
 * (constants/buffs.ts). Granted by Sentinel's charged skill to ALL ALLIES.
 *
 * DISTINCT FROM `Charge Overdrive II`, which also lives in buffs.ts and also grants +20% Defense
 * Penetration. That one is STANDING; this one is scoped to a single charged activation. The names
 * differ by one letter and the magnitudes are identical, which makes them very easy to
 * "deduplicate" by mistake. Do not.
 *
 * NAME-KEYED rather than a `parsedEffects` entry, for the usual reason: a one-shot per-cast bonus
 * has no standing value, and folding +20% pen into an incoming/outgoing channel would leak it into
 * every non-consuming reader.
 *
 * DURATION: none. Sentinel's parsed `duration: 3` is an artifact of the parser's backward scan
 * leaking the preceding clause's "for 3 turns"; `ONE_SHOT_PERSISTENT_BUFFS` membership makes that
 * irrelevant by routing the status to the persistent store.
 */
export const CHARGED_OVERDRIVE_II = 'Charged Overdrive II';

/** Percentage POINTS added to the cast's effective Defense Penetration. Percentage stats are
 *  stored as integers throughout this codebase (20 means 20%, not 0.20). */
export const CHARGED_OVERDRIVE_II_PEN = 20;

/**
 * True when the actor carries a Charged Overdrive II that {@link consumeChargedOverdriveII} can
 * SPEND. Narrowed to the timed + persistent channel for the same reason as every other one-shot —
 * see shieldConverter.ts for the full argument. A hand-picked selection is INERT.
 */
export function holdsChargedOverdriveII(statusEngine: StatusEngine, actorId: string): boolean {
    return statusEngine
        .timedAbilityStatuses('self', actorId)
        .some((s) => s.active.buffName === CHARGED_OVERDRIVE_II);
}

/**
 * Consume the holder's Charged Overdrive II. Called on ANY charged activation, damaging or not —
 * the game text is "the next Charged Skill activation", with no damage qualifier.
 *
 * Accepted consequence: Sentinel grants this to `all-allies` INCLUDING ITSELF, and Sentinel's own
 * charged skill deals no damage, so Sentinel spends its own copy for nothing. That is the literal
 * reading, and the alternatives (a post-damage consume point, or inspecting each recipient's kit
 * at grant time) both introduce machinery with no precedent in this engine.
 */
export function consumeChargedOverdriveII(statusEngine: StatusEngine, actorId: string): void {
    statusEngine.removeSelfBuffByName(actorId, CHARGED_OVERDRIVE_II);
}
