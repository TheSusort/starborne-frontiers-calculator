import type { AbilityTarget } from '../../types/abilities';

/**
 * THE one answer to "is this ability target enemy-side?" — the STORE axis, i.e. which of the
 * engine's two status stores a buff/debuff lands in (the caster's own SELF store, or the
 * per-victim ENEMY store keyed by the actor it was applied to).
 *
 * WHY A TOTAL `Record` AND NOT A `||` CHAIN. The key set is DERIVED from `AbilityTarget`, so `tsc`
 * rejects a new variant until somebody classifies it here. That is the whole point: before #399
 * this question was answered by four hand-written `||` chains in four files, three of which had
 * silently gone stale as selector targets were added — `engine.ts` (the status store side),
 * `playerTurn.ts` (the charge pool) and `triggers.ts` (charge removal) all omitted the three
 * selector targets, while `buffAbilityConverters.ts` listed them. A chain cannot fail to compile
 * when the union grows; this can. Same instrument as `enemyStoreChannelCoverage.test.ts` (#401),
 * applied to a different axis.
 *
 * The three SELECTOR targets are enemy-side. Each resolves at drain time to exactly ONE opposing
 * actor; naming one enemy rather than the whole opposing board changes the FOOTPRINT, never the
 * SIDE. Callers that need the footprint must resolve it themselves (see `triggers.ts`'s
 * `enemyWithMostBuffs` / `enemyWithHighestAttack` / `enemyWithHighestSpeed` delegates) — this map
 * deliberately answers only the side question.
 */
export const ABILITY_TARGET_SIDE: Record<AbilityTarget, 'self' | 'enemy'> = {
    self: 'self',
    ally: 'self',
    'all-allies': 'self',
    'lowest-hp-ally': 'self',
    'adjacent-allies': 'self',
    enemy: 'enemy',
    'all-enemies': 'enemy',
    // Enemy-side debuffs scoped to the resolved target's board neighbours, not self buffs.
    'adjacent-enemies': 'enemy',
    'target-and-adjacent-enemies': 'enemy',
    // Global selectors, resolved to one living opposing actor at drain time.
    'enemy-most-buffs': 'enemy',
    'enemy-highest-attack': 'enemy',
    'enemy-highest-speed': 'enemy',
};

export function isEnemyTarget(target: AbilityTarget): boolean {
    return ABILITY_TARGET_SIDE[target] === 'enemy';
}
