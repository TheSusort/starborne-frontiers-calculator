import type { DoTType } from '../../types/calculator';

/** A damage-over-time effect: every DoT family except Bomb, which is a debuff but not a
 *  damage-over-time effect (owner ruling R112). */
export const isDamageOverTime = (dotType: DoTType): boolean => dotType !== 'bomb';

/**
 * Whether `target` never receives a DoT of `dotType` (`CombatActor.dotImmune`, #519 General
 * Colosso). A landing site skips such an application before any landing roll: no roll, no resist,
 * no landing, no reaction — the contract `controlImmunityBlocks` (controlImmunity.ts) sets for
 * control. Bombs still land.
 */
export function immuneToDot(
    target: { dotImmune?: boolean } | undefined,
    dotType: DoTType
): boolean {
    return target?.dotImmune === true && isDamageOverTime(dotType);
}

/** `dots` without the entries `target` is immune to ({@link immuneToDot}); the same array when
 *  none is. */
export function withoutImmuneDots<T extends { type: DoTType }>(
    target: { dotImmune?: boolean } | undefined,
    dots: T[]
): T[] {
    return target?.dotImmune === true ? dots.filter((d) => !immuneToDot(target, d.type)) : dots;
}
