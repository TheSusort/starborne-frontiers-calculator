import { HealerConfig, HealingBuffTotals } from '../../types/calculator';

export interface HealingRoundData {
    round: number;
    action: 'active' | 'charged';
    healing: number;
    cumulativeHealing: number;
}

export interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number;
        avgHealingPerRound: number;
    };
}

export function simulateHealing(
    config: HealerConfig,
    numRounds: number,
    buffs?: HealingBuffTotals
): HealingSimulationResult {
    const effectiveCrit = Math.max(0, Math.min(100, config.crit + (buffs?.critBuff ?? 0)));
    const effectiveCritDamage = config.critDamage + (buffs?.critDamageBuff ?? 0);
    const critRate = effectiveCrit >= 100 ? 1 : effectiveCrit / 100;
    const critMultiplier = 1 + (critRate * effectiveCritDamage) / 100;
    const healModMult = 1 + (config.healModifier || 0) / 100;
    const outgoingHealMult = 1 + (buffs?.outgoingHealBuff ?? 0) / 100;

    const activeHealing =
        config.hp * (config.healPercent / 100) * critMultiplier * healModMult * outgoingHealMult;
    const chargedHealing =
        config.hp *
        ((config.chargedHealPercent || 0) / 100) *
        critMultiplier *
        healModMult *
        outgoingHealMult;

    const hasChargedSkill = config.chargedHealPercent > 0 && config.chargeCount >= 1;
    let charges = config.startCharged ? config.chargeCount : 0;
    let cumulativeHealing = 0;

    const rounds: HealingRoundData[] = [];

    for (let r = 1; r <= numRounds; r++) {
        let action: 'active' | 'charged';
        let healing: number;

        if (hasChargedSkill && charges >= config.chargeCount) {
            action = 'charged';
            healing = chargedHealing;
            charges = 0;
        } else {
            action = 'active';
            healing = activeHealing;
            if (hasChargedSkill) charges += 1;
        }

        cumulativeHealing += healing;

        rounds.push({
            round: r,
            action,
            healing: Math.round(healing),
            cumulativeHealing: Math.round(cumulativeHealing),
        });
    }

    return {
        rounds,
        summary: {
            totalHealing: Math.round(cumulativeHealing),
            avgHealingPerRound: Math.round(cumulativeHealing / numRounds),
        },
    };
}
