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

/** Duration Toxic Overflow is applied with. The game rule is that it LINGERS until a qualifying
 *  end-of-round check spreads it and then removes it — it has NO turn-based expiry. A finite window
 *  is wrong: if Corrosion first arrives several rounds after Toxic Overflow lands, a finite duration
 *  would have already expired the status and it could never spread.
 *
 *  Represented as `Number.POSITIVE_INFINITY` — the same non-expiring representation the engine
 *  already uses for cast-path Cheat-Death grants (engine.ts): it stays a plain numeric duration
 *  (so the status classifies as a REMOVABLE timed debuff, not an undefined-duration un-removable
 *  aura, and the `kind: 'timed'` variant's `duration: number` contract holds), yet never decrements
 *  to expiry (`Infinity − 1 === Infinity`; the Post-Turn expiry check compares `<= 0`). Crucially it
 *  is NOT routed into the persistent-stacking machinery — that routing is gated solely on
 *  `PERSISTENT_STACKING_BUFFS.has(name)`, and Toxic Overflow is not a member — so it lands in the
 *  ordinary per-victim timed enemy-debuff store where the engine's targeted
 *  `removeTimedEnemyStatus(holderId, TOXIC_OVERFLOW)` (a raw family delete, no unremovable guard)
 *  removes it the moment it spreads. */
export const TOXIC_OVERFLOW_DURATION = Number.POSITIVE_INFINITY;

/** The Corrosion tier the spread inflicts — "Corrosion I" (matches DOT_TIER_MAP['Corrosion I'].tier
 *  in skillBuffAutoFill.ts; the roman "I" is the game label, the engine stores the numeric per-tick
 *  potency). */
export const SPREAD_CORROSION_TIER = 3;

/** Turns the spread "Corrosion I" DoT lasts (game text: "for 3 turns"). */
export const SPREAD_CORROSION_DURATION = 3;
