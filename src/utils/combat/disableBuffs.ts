/** Named debuffs that mean DISABLE — the game's second turn-skip control (after Stasis).
 *  While a unit carries an active Disable it cannot take its scheduled ACTION (active/charged
 *  skill + attack) and its reactive abilities ARE suppressed — IDENTICAL to Stasis on those two
 *  axes (recognized via the engine's `isTurnBlocked` composite; the reactive drain filter routes
 *  through `isTurnBlocked`, so a disabled unit's reactive intents are dropped at drain time).
 *  DoTs still tick and all timed statuses (Disable included) still decrement on the skipped turn,
 *  so duration N skips exactly N scheduled actions.
 *
 *  DIVERGES from Stasis on ONE axis (do NOT wire Disable into the Stasis-only break/immunity
 *  sites): it is NOT broken by a direct hit (Stasis is, see engine §4.5) — Disable persists when
 *  hit. Like Stasis, a disabled unit has NO damage immunity — hits land normally.
 *
 *  Carried as a timed debuff in the victim's per-actor enemy-debuff store (decrements via the
 *  Post-Turn decrement). Disable carries no stat payload; duration comes from "for N turns".
 *  Extend from game data as other named turn-skip controls appear (e.g. Stun/Freeze). */
export const DISABLE_BUFFS: ReadonlySet<string> = new Set(['Disable']);

/** True iff `buffName` is a Disable turn-skip control. */
export function isDisable(buffName: string): boolean {
    return DISABLE_BUFFS.has(buffName);
}
