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

const CONTROL_SET: ReadonlySet<string> = new Set(CONTROL_EFFECT_STATUSES);

/** Speed modifier of each named buff in the game data, parsed once. */
const dataSpeedByName: ReadonlyMap<string, number | undefined> = new Map(
    BUFFS.map((b) => [b.name, parseBuffEffects(b.name, b.description).speed])
);

/**
 * True for a debuff a control-immune unit never receives (#519 owner ruling: Provoke, Taunt,
 * Stasis, Concentrate Fire, Disable and every speed debuff). A speed debuff is any status whose
 * effects lower speed — read from the application's own `effects` when given, else from the
 * game's buff data.
 *
 * Every enemy-status landing site asks this BEFORE its landing roll and skips the application
 * entirely on a `CombatActor.controlImmune` target: no roll, no resist, no landing, no reaction
 * — the same shape as the #590 outclass skip.
 */
export function isControlOrSpeedDebuff(buffName: string, effects?: ParsedBuffEffects): boolean {
    if (CONTROL_SET.has(buffName)) return true;
    return (effects?.speed ?? dataSpeedByName.get(buffName) ?? 0) < 0;
}

/** Whether `target` never receives `buffName` (see {@link isControlOrSpeedDebuff}). */
export function immuneToEnemyStatus(
    target: { controlImmune?: boolean } | undefined,
    buffName: string,
    effects?: ParsedBuffEffects
): boolean {
    return target?.controlImmune === true && isControlOrSpeedDebuff(buffName, effects);
}
