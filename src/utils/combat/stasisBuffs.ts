/** Named debuffs that mean STASIS — the game's only true turn-skip control. While a unit
 *  carries an active Stasis status it cannot take its scheduled ACTION (active/charged skill
 *  + attack); the unit's DoTs still tick on it and all its timed statuses (Stasis included)
 *  still decrement on the skipped turn, so duration N skips exactly N scheduled actions.
 *  Recognized by the engine's turn-loop action gate (`isStasised`); carried as a timed
 *  debuff in the victim's per-actor enemy-debuff store (decrements via decrementEnemy(id)).
 *  Stasis carries NO stat payload (empty parsedEffects) — duration is parsed from "for N
 *  turns", NOT from the name, so there are no "Stasis I/II" variants. Extend from game data
 *  as identified. */
export const STASIS_BUFFS: ReadonlySet<string> = new Set(['Stasis']);

/** True iff `buffName` is a Stasis turn-skip control. */
export function isStasis(buffName: string): boolean {
    return STASIS_BUFFS.has(buffName);
}
