import { HealerConfig, HealingBuffTotals } from '../../types/calculator';

export interface HealingResult {
    activeBaseHealing: number;
    activeHealingWithCrit: number;
    activeEffectiveHealing: number;
    chargedBaseHealing: number;
    chargedHealingWithCrit: number;
    chargedEffectiveHealing: number;
    /** Average per round over the full charge cycle (= activeEffectiveHealing when no charged skill) */
    effectiveHealing: number;
}

export function calculateHealing(config: HealerConfig, buffs?: HealingBuffTotals): HealingResult {
    const effectiveCrit = Math.max(0, Math.min(100, config.crit + (buffs?.critBuff ?? 0)));
    const effectiveCritDamage = config.critDamage + (buffs?.critDamageBuff ?? 0);
    const critRate = effectiveCrit >= 100 ? 1 : effectiveCrit / 100;
    const critMultiplier = 1 + (critRate * effectiveCritDamage) / 100;
    const healModMult = 1 + (config.healModifier || 0) / 100;

    const activeBase = config.hp * (config.healPercent / 100);
    const activeEffective = activeBase * critMultiplier * healModMult;

    const chargedBase = config.hp * ((config.chargedHealPercent || 0) / 100);
    const chargedEffective = chargedBase * critMultiplier * healModMult;

    let effectiveHealing: number;
    if (config.chargeCount > 0 && config.chargedHealPercent > 0) {
        // 1 charged + chargeCount active shots per cycle
        effectiveHealing =
            (chargedEffective + config.chargeCount * activeEffective) / (config.chargeCount + 1);
    } else {
        effectiveHealing = activeEffective;
    }

    return {
        activeBaseHealing: activeBase,
        activeHealingWithCrit: activeBase * critMultiplier,
        activeEffectiveHealing: activeEffective,
        chargedBaseHealing: chargedBase,
        chargedHealingWithCrit: chargedBase * critMultiplier,
        chargedEffectiveHealing: chargedEffective,
        effectiveHealing,
    };
}
