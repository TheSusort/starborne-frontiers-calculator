import type { StatusEngine } from './statusEngine';
// Call-time-safe cycle (same pattern as blockBuffBuffs.ts): triggers imports the predicate
// from here for its Barrier-grant gate, and we import selfBuffNamesForOwners back. Both are
// used only inside function bodies → no init-order hazard.
// eslint-disable-next-line import/no-cycle
import { selfBuffNamesForOwners } from './triggers';

/** "Cannot be granted Barrier. Cannot be reduced. Unremovable." Applied by Panon (to itself)
 *  and Quixilver (to all allies). While a unit carries it, any NEW Barrier grant targeting it
 *  is silently skipped — no status, no event, no log — which is what makes it a real cooldown
 *  rather than a decorative status. Already-held Barriers are untouched. */
export const BARRIER_RECHARGING = 'Barrier Recharging';

/** True if `actorId` currently carries Barrier Recharging.
 *
 *  Reads the SELF-side store, unlike the otherwise-identical Block Buff predicate, which reads
 *  the inflicted-debuff store. Barrier Recharging is a negative status that lands on friendlies
 *  (Panon applies it to itself; Quixilver to all allies), so it lives self-side — the same store
 *  the engine's existing `hasBarrierRecharging` reads for Panon's incoming-reduction gate.
 *  statusEngine is unified across both teams and keyed by actor id, so this is symmetric. */
export function holdsBarrierRecharging(statusEngine: StatusEngine, actorId: string): boolean {
    return selfBuffNamesForOwners(statusEngine, [actorId]).includes(BARRIER_RECHARGING);
}
