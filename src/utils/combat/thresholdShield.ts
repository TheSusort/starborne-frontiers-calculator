import type { Ability } from '../../types/abilities';

/**
 * Lifeline (incoming-shield-grant) — pre-hit threshold shield decision.
 *
 * Returns the FIRST `incoming-shield-grant` ability that should fire on this hit and the raw
 * (uncapped) shield amount to grant, or null if none fires. Pure — no engine state. The caller
 * applies the max-HP pool cap and records the once-per-battle fired flag.
 *
 * Fires when ALL hold:
 *   (a) the hit is a pure direct hit (no DoT, no bomb portion) — `isDirect`;
 *   (b) the ability has not yet fired this battle — `!alreadyFired(ability.id)`;
 *   (c) a downward crossing of the threshold: pre-hit HP >= T AND would-be HP < T,
 *       where T = hpThresholdPct/100 * maxHp and would-be HP = currentHp - provisionalHpDamage.
 *
 * `provisionalHpDamage` is the HP damage the hit would deal computed against the CURRENT shield
 * pool (a shieldAbsorb run before any Lifeline grant). The grant = flatAmount + effectiveAttack
 * * attackPct/100.
 */
export function thresholdShieldForHit(args: {
    abilities: Ability[];
    currentHp: number;
    maxHp: number;
    provisionalHpDamage: number;
    effectiveAttack: number;
    isDirect: boolean;
    alreadyFired: (abilityId: string) => boolean;
}): { abilityId: string; grant: number } | null {
    const {
        abilities,
        currentHp,
        maxHp,
        provisionalHpDamage,
        effectiveAttack,
        isDirect,
        alreadyFired,
    } = args;
    if (!isDirect) return null;
    for (const ability of abilities) {
        const cfg = ability.config;
        if (cfg.type !== 'incoming-shield-grant') continue;
        if (alreadyFired(ability.id)) continue;
        const threshold = (cfg.hpThresholdPct / 100) * maxHp;
        const wouldBeHp = currentHp - provisionalHpDamage;
        if (currentHp >= threshold && wouldBeHp < threshold) {
            return {
                abilityId: ability.id,
                grant: cfg.flatAmount + effectiveAttack * (cfg.attackPct / 100),
            };
        }
    }
    return null;
}
