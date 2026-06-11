/** Named buffs that grant FULL DAMAGE IMMUNITY for the duration of the buff. While a ship
 *  carries an active Barrier status, ALL incoming damage to it is blocked — direct attacks,
 *  DoT ticks, AND bomb detonations. Recognized by the engine's incoming-damage resolver
 *  (`applyIncomingToTarget`); carried as timed/recurring statuses in the StatusEngine.
 *  Duration-based (expires via the normal timed lifecycle), NOT consumed on first hit, and
 *  strictly "in front of" both the shield pool AND Cheat Death. Extend from game data as
 *  identified. */
export const BARRIER_BUFFS: ReadonlySet<string> = new Set(['Barrier']);
