/** Named buffs that grant FULL DAMAGE IMMUNITY for the duration of the buff. While a ship
 *  carries an active Barrier status, ALL incoming damage to it is blocked — direct attacks,
 *  DoT ticks, AND bomb detonations. Recognized by the engine's incoming-damage resolver
 *  (`applyIncomingToTarget`); carried as timed/recurring statuses in the StatusEngine.
 *  Lifecycle is EITHER duration-based (the normal timed lifecycle) OR hit-counted (the buff
 *  config's `hits`, spent at the absorb site via consumeStatusHit) — a grant carrying both
 *  expires on whichever comes first. Strictly "in front of" both the shield pool AND Cheat Death.
 *  Extend from game data as identified. */
export const BARRIER_BUFFS: ReadonlySet<string> = new Set(['Barrier']);
