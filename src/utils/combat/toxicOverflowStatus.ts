import { TOXIC_OVERFLOW } from '../../constants/toxicOverflow';
import type { StatusEngine } from './statusEngine';

/**
 * True when `victimId` carries a `Toxic Overflow` that the end-of-round spread can actually SPEND.
 *
 * The third member of the narrowed-one-shot family, alongside `holdsHitMitigation` (hitMitigation.ts)
 * and `exposedIncomingPct` (exposedStatus.ts). All three obey the same rule — read exactly the
 * channel the removal can reach — and this one exists as a named predicate so the family reads as a
 * family at its call site instead of one inline `.some()` among two imports.
 *
 * Deliberately NOT `ownerDebuffNames`, the broad three-channel name union. Toxic Overflow is a
 * CONSUMABLE ("At the end of the round if a unit has Toxic Overflow and at least 1 stack of
 * Corrosion, inflict Corrosion I for 3 turns to all adjacent allies **and remove Toxic Overflow**"),
 * and the engine's `removeTimedEnemyStatus(holderId, TOXIC_OVERFLOW)` reaches only the per-victim
 * TIMED enemy-debuff store. Reading wider made the status unspendable and the spread self-sustaining:
 * it is offered by the calculator's debuff picker, which emits no turn count, and an always-active
 * scheduled debuff is injected into EVERY target's snapshot with no per-victim entry to delete.
 *
 * `timedAbilityStatuses` also surfaces the ability-sourced PERSISTENT-stacking store, which
 * `removeTimedEnemyStatus` likewise cannot reach — harmless here because that routing is gated
 * solely on `PERSISTENT_STACKING_BUFFS.has(name)` and Toxic Overflow is not a member
 * (`constants/persistentStackingBuffs.ts`), so the branch is unreachable for this status. Same
 * unreachable-branch note as `exposedIncomingPct`'s.
 *
 * Hemlock's real charged application lands in the timed store non-expiring by construction — see
 * `constants/toxicOverflow.ts`, which keeps the name/duration literals because it must stay
 * import-free for `buildShipAbilities` (hence this predicate living here rather than there).
 */
export function holdsToxicOverflow(statusEngine: StatusEngine, victimId: string): boolean {
    return statusEngine
        .timedAbilityStatuses('enemy', undefined, victimId)
        .some((s) => s.active.buffName === TOXIC_OVERFLOW);
}
