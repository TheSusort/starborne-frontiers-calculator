import type { StatusEngine } from './statusEngine';

/**
 * `Reversed Repairs` — "Incoming repairs damage this unit instead" (constants/buffs.ts).
 *
 * NAME-KEYED, like Exposed / Stealth / Barrier, rather than a `parsedEffects` entry. There is no
 * standing percentage to fold: the status does not scale a channel, it inverts one. Folding it
 * into `incomingHeal` is the trap the spec calls out — that fold is unclamped, so a negative
 * multiplier produces `consumed: 0` plus a NEGATIVE overheal: no damage, no healing, garbage
 * statistics, and green tests throughout.
 *
 * Applier in the corpus: Zosimos's charged skill ("inflicts Reversed Repairs for 1 turn").
 *
 * Read at the single heal-apply site (`engine.ts` `applyHealToTarget`), which is the ONLY line in
 * the combat engine where HP goes up — so every repair channel is covered by one branch.
 */
export const REVERSED_REPAIRS = 'Reversed Repairs';

/**
 * Whether this victim's incoming repairs are reversed.
 *
 * Boolean, not a magnitude: reversal is not a scaling factor and stacks mean nothing here.
 *
 * Reads BOTH enemy-side channels. This is a deliberate divergence from `exposedIncomingPct`,
 * which reads only the timed store because a one-shot "next direct hit" status has no standing
 * value and a hand-selected one is correctly inert. A 1-turn duration debuff does have a standing
 * value, so a Reversed Repairs selected by hand in the simulator must work.
 */
export function hasReversedRepairs(statusEngine: StatusEngine, victimId: string): boolean {
    const timed = statusEngine
        .timedAbilityStatuses('enemy', undefined, victimId)
        .some((s) => s.active.buffName === REVERSED_REPAIRS);
    if (timed) return true;
    return statusEngine
        .snapshot(undefined, victimId)
        .activeEnemyDebuffs.some((b) => b.buffName === REVERSED_REPAIRS);
}
