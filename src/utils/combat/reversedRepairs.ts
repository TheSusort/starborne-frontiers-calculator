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
 * Reads BOTH enemy-side channels, but only the TIMED arm is unconditionally per-victim, and only
 * that arm is safe on both teams:
 *
 *  - TIMED arm — ungated on side, deliberately. `timedAbilityStatuses('enemy', undefined,
 *    victimId)` is correctly keyed to `victimId` (it reads the per-target enemy map, see
 *    `statusEngine.ts`'s `timedEnemy` upsert), and it is the channel the real corpus applier
 *    (Zosimos's charged skill, "inflicts Reversed Repairs for 1 turn") lands on. Team symmetry is
 *    mandatory in this engine — an enemy Zosimos debuffing a PLAYER ship must reverse that ship's
 *    repairs, so this arm must fire for player-side victims too. Do not add a side gate here.
 *
 *  - SCHEDULED arm — gated on `victim.side === 'enemy'`, and this gate is load-bearing, not
 *    cosmetic. `enemyAlwaysSnap` (`statusEngine.ts`, inside `snapshot`) builds from a single
 *    global `alwaysEnemy` list with NO per-victim keying whatsoever — unlike the accum, persistent
 *    and timed enemy arms right next to it, which all key off `enemyTargetId`/`enemyTargetId`-like
 *    maps. Passing a `victimId` into `snapshot(undefined, victimId)` does nothing for this arm: it
 *    ignores the id entirely and returns the same global list for ANY id, including a player-side
 *    actor's. Before this gate existed, `hasReversedRepairs` read `true` for literally every id
 *    probed — `attacker`, `foe`, `player-3`, `enemy-7`, `literally-anything` — because the
 *    scheduled arm has nothing else to filter on. The calculator's `enemyDebuffs` picker means
 *    "debuffs the OPPOSING team carries", so without this gate a user ticking Reversed Repairs in
 *    the enemy-debuff picker would reverse their OWN team's repairs into damage. `side` is the
 *    only signal available to stop that leak, since the underlying store carries none.
 *
 * This is exactly why `exposedStatus.ts`'s `exposedIncomingPct` reads ONLY the timed channel and
 * drops the scheduled one outright rather than gating it: Exposed's "next direct hit" has no
 * standing value to model, so making the scheduled arm inert is the faithful rendering there. A
 * 1-turn Reversed Repairs DOES have a standing value, so it can't be dropped the same way — it has
 * to be gated instead. If a future reader sees this asymmetric gate (timed ungated, scheduled
 * gated) and is tempted to "simplify" it to one rule for both arms: don't — the two arms have
 * fundamentally different keying, and collapsing them either breaks Zosimos's cross-team debuff or
 * reopens the enemy-picker leak.
 */
export function hasReversedRepairs(
    statusEngine: StatusEngine,
    victim: { id: string; side: 'player' | 'enemy' }
): boolean {
    const timed = statusEngine
        .timedAbilityStatuses('enemy', undefined, victim.id)
        .some((s) => s.active.buffName === REVERSED_REPAIRS);
    if (timed) return true;
    if (victim.side !== 'enemy') return false;
    return statusEngine
        .snapshot(undefined, victim.id)
        .activeEnemyDebuffs.some((b) => b.buffName === REVERSED_REPAIRS);
}
