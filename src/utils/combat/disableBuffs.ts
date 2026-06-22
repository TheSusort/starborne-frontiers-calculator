/** Named debuffs that mean DISABLE — the game's second turn-skip control (after Stasis).
 *  While a unit carries an active Disable it cannot take its scheduled ACTION (active/charged
 *  skill + attack) and its reactive abilities are suppressed — IDENTICAL to Stasis on those two
 *  axes (recognized via the engine's `isTurnBlocked` composite; the reactive drain filter is
 *  routed through `isTurnBlocked` in the reactive-suppression task; until then a disabled unit's
 *  reactives still fire). DoTs still tick and all timed
 *  statuses (Disable included) still decrement on the skipped turn, so duration N skips exactly
 *  N scheduled actions.
 *
 *  DIVERGES from Stasis on two axes (do NOT wire Disable into the Stasis-only sites):
 *    - NOT broken by a direct hit (Stasis is, see engine §4.5) — Disable persists when hit.
 *    - NO damage immunity — hits land normally (same as Stasis, which also takes damage).
 *
 *  Carried as a timed debuff in the victim's per-actor enemy-debuff store (decrements via the
 *  Post-Turn decrement). Disable carries no stat payload; duration comes from "for N turns".
 *  Extend from game data as other named turn-skip controls appear (e.g. Stun/Freeze). */
export const DISABLE_BUFFS: ReadonlySet<string> = new Set(['Disable']);

/** True iff `buffName` is a Disable turn-skip control. */
export function isDisable(buffName: string): boolean {
    return DISABLE_BUFFS.has(buffName);
}
