/** Named buffs that grant a one-shot death-intercept (Cheat Death). Recognized by the
 *  engine's lethal-damage resolver; carried as no-payload buffs in the StatusEngine. */
export const CHEAT_DEATH_BUFFS: ReadonlySet<string> = new Set(['Cheat Death']);

/** Named statuses that survive a cleanse/purge/Cheat-Death wipe. Persistent-stacking
 *  debuffs (Defense Shred/Blast/Overload/Titanite) are unremovable by construction
 *  (handled via the persistent-stack classification); this set names any ADDITIONAL
 *  unremovable effects. Extend from game data as identified. */
/** Statuses a buff-steal moves ONE STACK AT A TIME rather than as a whole entry.
 *
 *  Protection's in-game description reads "stackable, unremovable and stealable", and the owner
 *  ruled (2026-09-03) that a generic "steal 1 buff" takes exactly one of its stacks — leaving the
 *  source the rest. So membership here does two things: it exempts the name from the steal's
 *  {@link UNREMOVABLE_STATUSES} skip (unremovable means a CLEANSE cannot strip it, never that a
 *  steal cannot take it — purge/cleanse still honour that set), and it routes the transfer through
 *  the StatusEngine's per-owner stack ledger instead of moving a timed entry.
 *
 *  Stack candidates always rank BELOW every timed candidate in the steal's newest-first ordering,
 *  because a start-of-combat grant is the oldest thing a ship carries. That is what keeps every
 *  shipped Pallas/Thresh/Tithonus steal on its existing target. */
export const STACK_STEALABLE_STATUSES: ReadonlySet<string> = new Set<string>(['Protection']);

export const UNREMOVABLE_STATUSES: ReadonlySet<string> = new Set<string>([
    // Description-marked-unremovable effect (e.g. "Acidic Decay" states it in-game) — if it
    // lands in the StatusEngine it survives clearRemovable (and a Cheat Death wipe).
    'Acidic Decay',
    // Marked "Unremovable" in its in-game description — survives cleanse/purge/Cheat Death.
    'Magnetized Shielding',
    // Confirmed in-game "Unremovable" debuffs from the game UI (2026-06-19).
    'Barrier Recharging',
    'Damage to Dot',
    // Confirmed in-game "Unremovable" BUFF from the game UI (2026-06-19).
    'Protection',
]);
