/** Named buffs that make the holder's buffs UNREMOVABLE BY PURGE for the buff's duration.
 *  A purge against a Buff-Protection holder removes 0 buffs (the whole purge is blocked).
 *  Purge-only: cleanse (debuff removal) and buff-steal are unaffected. Holder-state guard,
 *  NOT a per-buff property (cf. UNREMOVABLE_STATUSES). Extend from game data as identified. */
export const BUFF_PROTECTION_BUFFS: ReadonlySet<string> = new Set(['Buff Protection']);
export const isBuffProtection = (name: string): boolean => BUFF_PROTECTION_BUFFS.has(name);
