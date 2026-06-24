import type { StatusEngine } from './statusEngine';
// Call-time-safe cycle (same pattern as debuffImmunity.ts): triggers imports
// recipientCarriesBlockBuff from here for its reactive-buff guard, and we import
// ownerDebuffNamesFor back. Both used only inside function bodies → no init-order hazard.
// eslint-disable-next-line import/no-cycle
import { ownerDebuffNamesFor } from './triggers';

/** Named statuses that make the carrier IMMUNE TO RECEIVING BUFFS. While a unit carries a
 *  Block Buff status, any NEW timed buff application targeting it is silently skipped (the
 *  buff does not land — no event, no log). Already-landed buffs, stat folding, and the
 *  carrier's own recurring auras are untouched. Inflicted as a debuff on the carrier (so it
 *  lives in the per-target debuff store — read via ownerDebuffNamesFor, NOT
 *  selfBuffNamesForOwners). Extend from game data as identified. */
export const BLOCK_BUFF_BUFFS: ReadonlySet<string> = new Set(['Block Buff']);
export const isBlockBuff = (name: string): boolean => BLOCK_BUFF_BUFFS.has(name);

/** True if `recipientId` currently carries a Block Buff status. Reads the inflicted-debuff
 *  store (statusEngine is unified across both teams and keyed by actor id, so this works
 *  symmetrically for a Block-Buffed player and a Block-Buffed enemy). */
export function recipientCarriesBlockBuff(
    statusEngine: StatusEngine,
    recipientId: string
): boolean {
    return ownerDebuffNamesFor(statusEngine, recipientId).some(isBlockBuff);
}
