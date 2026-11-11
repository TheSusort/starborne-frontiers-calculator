import { BUFFS } from '../../constants/buffs';
import { parseBuffEffects } from '../calculators/buffParser';
import type { ParsedBuffEffects } from '../../types/calculator';

/** The statuses "a control effect" covers (user ruling 2026-10-02). */
export const CONTROL_EFFECT_STATUSES: readonly string[] = [
    'Stasis',
    'Disable',
    'Provoke',
    'Taunt',
    'Concentrate Fire',
];

/** The control statuses a control-immune unit never receives. Provoke, Taunt and Concentrate
 *  Fire are absent: they land on it as ordinary debuffs, and its own targeting ignores them
 *  instead (`CombatActor.controlImmune`). */
const NEVER_LANDS_ON_CONTROL_IMMUNE: ReadonlySet<string> = new Set(['Stasis', 'Disable']);

/** Speed modifier of each named buff in the game data, parsed once. */
const dataSpeedByName: ReadonlyMap<string, number | undefined> = new Map(
    BUFFS.map((b) => [b.name, parseBuffEffects(b.name, b.description).speed])
);

/**
 * True for a debuff a control-immune unit never receives (#519 owner ruling: Stasis, Disable
 * and every speed debuff). A speed debuff is any status whose effects lower speed — read from
 * the application's own `effects` when given, else from the game's buff data.
 *
 * A landing site skips the application entirely on a `CombatActor.controlImmune` target, before
 * any landing roll: no roll, no resist, no landing, no reaction — beside the #590 outclass skip.
 */
export function controlImmunityBlocks(buffName: string, effects?: ParsedBuffEffects): boolean {
    if (NEVER_LANDS_ON_CONTROL_IMMUNE.has(buffName)) return true;
    return (effects?.speed ?? dataSpeedByName.get(buffName) ?? 0) < 0;
}

/** Whether `target` never receives `buffName` (see {@link controlImmunityBlocks}). */
export function immuneToEnemyStatus(
    target: { controlImmune?: boolean } | undefined,
    buffName: string,
    effects?: ParsedBuffEffects
): boolean {
    return target?.controlImmune === true && controlImmunityBlocks(buffName, effects);
}
