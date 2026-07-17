// Toxic Overflow / Corrosion-spread mechanic (ship-kit W3, ledger #49).
//
// Hemlock's charged skill inflicts the "Toxic Overflow" debuff, whose game rule
// (src/constants/buffs.ts) is: "At the end of the round if a unit has Toxic Overflow and at
// least 1 stack of Corrosion, inflict Corrosion I for 3 turns to all adjacent allies and remove
// Toxic Overflow." The engine's end-of-round processing reads this named status off the per-victim
// timed enemy-debuff store, spreads Corrosion to the holder's adjacent allies, removes the status,
// and emits a `corrosion-spread` event (Hemlock's passive self-heal rides that event).
//
// Leaf module (no imports) so both the ability builder (buildShipAbilities) and the combat engine
// can share these literals without an import cycle.

/** The named debuff Hemlock's charged skill inflicts; the end-of-round spread mechanic keys on it. */
export const TOXIC_OVERFLOW = 'Toxic Overflow';

/** Turns Toxic Overflow persists while it waits for the holder to carry Corrosion at an
 *  end-of-round check. The game text states no explicit duration (it lingers until it spreads and
 *  is then removed); a finite window is used so the status classifies as a REMOVABLE timed debuff
 *  (an undefined duration would make it an un-removable aura) and so it expires if it never finds
 *  Corrosion to spread. Chosen to comfortably outlast the round it is applied in. */
export const TOXIC_OVERFLOW_DURATION = 3;

/** The Corrosion tier the spread inflicts — "Corrosion I" (matches DOT_TIER_MAP['Corrosion I'].tier
 *  in skillBuffAutoFill.ts; the roman "I" is the game label, the engine stores the numeric per-tick
 *  potency). */
export const SPREAD_CORROSION_TIER = 3;

/** Turns the spread "Corrosion I" DoT lasts (game text: "for 3 turns"). */
export const SPREAD_CORROSION_DURATION = 3;
