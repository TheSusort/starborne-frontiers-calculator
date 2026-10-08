import type { Ability } from '../../types/abilities';

/**
 * Intra-cast clause order: within one firing slot, a clause resolves after the clauses written
 * before it. `Skill.abilities` IS clause order — `buildShipAbilities` sorts each slot by text
 * position — so a clause's place relative to the slot's damage clause is its index relative to
 * the first damage clause.
 */

/** A real damage-dealing clause. A 0-multiplier entry is a structural no-op (the fixtures'
 *  "took a turn" placeholder) and orders nothing. */
export const isDamageClause = (ability: Ability): boolean =>
    ability.config.type === 'damage' && ability.config.multiplier > 0;

/** Where a firing-slot clause sits relative to its slot's damage: written ahead of the first
 *  damage clause, after it, or in a slot that deals no damage at all. */
export type ClausePhase = 'before-damage' | 'after-damage' | 'no-damage';

export function clausePhase(slotAbilities: readonly Ability[], ability: Ability): ClausePhase {
    const at = slotAbilities.indexOf(ability);
    const firstDamage = slotAbilities.findIndex(isDamageClause);
    if (at < 0 || firstDamage < 0) return 'no-damage';
    return at < firstDamage ? 'before-damage' : 'after-damage';
}

/**
 * A firing-slot status REMOVAL that resolves ahead of the cast's damage: a buff steal, an enemy
 * purge or a self-cleanse written before the damage clause ("steals 1 buff and deals 300%
 * damage", "purges 1 buff from the enemy and deals 200% damage", "cleanses 2 debuffs, deals 145%
 * damage"). `runPlayerTurn` runs these before the caster's stats are folded, so a stolen buff
 * counts, a cleansed debuff does not, and a purged buff is gone from the victim.
 *
 * Only an UNGATED, unscaled clause qualifies: its gate context and its crit-power scaling do not
 * exist that early in the turn, so a gated or scaled removal runs with the turn's late removal
 * loops instead; `writtenOrderRemovalCorpus.test.ts` fails if a shipped ship ever writes one ahead
 * of its damage.
 * An ally-aimed cleanse cannot change the caster's own hit, so it stays in the support pass.
 * Meatshield's named Protection top-up is not a plain steal and keeps its own path.
 */
export function isRemovalBeforeDamage(
    slotAbilities: readonly Ability[],
    ability: Ability
): boolean {
    if (ability.trigger !== 'on-cast' || ability.conditions.length > 0) return false;
    if (clausePhase(slotAbilities, ability) !== 'before-damage') return false;
    const cfg = ability.config;
    switch (cfg.type) {
        case 'buff-steal':
            return cfg.buffName === undefined && cfg.upToStacks === undefined;
        case 'purge':
            return cfg.countScaling === undefined;
        case 'cleanse':
            return (
                ability.target === 'self' &&
                cfg.countScaling === undefined &&
                cfg.mode !== 'reduce-duration'
            );
        default:
            return false;
    }
}
