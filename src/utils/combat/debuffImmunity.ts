import type { StatusEngine } from './statusEngine';
import { selfBuffNamesForOwners } from './triggers';
import type { CombatEventBus } from './events';

/** Named buffs that make the holder IMMUNE to receiving debuffs. While active, every incoming
 *  debuff application (timed, persistent-stacking, DoT, control-as-named-debuff) is blocked and
 *  recorded as a RESIST. Already-landed debuffs are untouched. Extend from game data. */
export const BLOCK_DEBUFF_BUFFS: ReadonlySet<string> = new Set(['Block Debuff']);
export const isBlockDebuff = (name: string): boolean => BLOCK_DEBUFF_BUFFS.has(name);

/** True if `targetId` currently carries a Block Debuff buff (reads its self-buff names). */
export function targetCarriesBlockDebuff(statusEngine: StatusEngine, targetId: string): boolean {
    return selfBuffNamesForOwners(statusEngine, [targetId]).some(isBlockDebuff);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
/** Single source of truth for the resisted-debuff label of a blocked DoT, so the emit site and
 *  the test assertion agree. e.g. ('inferno', 3) -> 'Inferno III'; ('bomb', 0) -> 'Bomb'. */
export function dotResistLabel(dotType: 'corrosion' | 'inferno' | 'bomb', tier: number): string {
    const kind = dotType.charAt(0).toUpperCase() + dotType.slice(1);
    const numeral = tier > 0 && tier < ROMAN.length ? ` ${ROMAN[tier]}` : '';
    return dotType === 'bomb' ? kind : `${kind}${numeral}`;
}

/** Emit a debuff-resisted event for a Block-Debuff-blocked DoT. Call ONLY on the block path —
 *  normal DoT landing-roll failures stay silent (byte-identical). */
export function emitBlockDebuffResist(
    bus: CombatEventBus,
    targetId: string,
    round: number,
    buffName: string
): void {
    bus.emit({ type: 'debuff-resisted', targetId, round, buffName });
}
