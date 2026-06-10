/** Named buffs that grant a one-shot death-intercept (Cheat Death). Recognized by the
 *  engine's lethal-damage resolver; carried as no-payload buffs in the StatusEngine. */
export const CHEAT_DEATH_BUFFS: ReadonlySet<string> = new Set(['Cheat Death']);

/** Named statuses that survive a cleanse/purge/Cheat-Death wipe. Persistent-stacking
 *  debuffs (Defense Shred/Blast/Overload/Titanite) are unremovable by construction
 *  (handled via the persistent-stack classification); this set names any ADDITIONAL
 *  unremovable effects. Extend from game data as identified. */
export const UNREMOVABLE_STATUSES: ReadonlySet<string> = new Set<string>([
    // Description-marked-unremovable effect (e.g. "Acidic Decay" states it in-game) — if it
    // lands in the StatusEngine it survives clearRemovable (and a Cheat Death wipe).
    'Acidic Decay',
    // Marked "Unremovable" in its in-game description — survives cleanse/purge/Cheat Death.
    'Magnetized Shielding',
]);
