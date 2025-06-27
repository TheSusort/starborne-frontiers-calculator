import { BaseStats } from '../../types/stats';
import { ShipTypeName } from '../../constants';
import { calculateDamageReduction, calculateHealingPerHit } from '../autogear/scoring';
import {
    ENEMY_ATTACK,
    ENEMY_COUNT,
    ENEMY_SECURITY,
    BASE_HEAL_PERCENT,
} from '../../constants/simulation';
export interface SimulationSummary {
    // Common
    averageDamage?: number;
    highestHit?: number;
    lowestHit?: number;
    critRate?: number;

    // Defender specific
    effectiveHP?: number;
    survivedRounds?: number;
    damageReduction?: number;
    shieldPerRound?: number;
    healingPerHit?: number;
    hp?: number;
    hpRegen?: number;
    security?: number;

    // Debuffer specific
    hackSuccessRate?: number;

    // Supporter specific
    averageHealing?: number;
    highestHeal?: number;
    lowestHeal?: number;

    // Supporter(Buffer) specific
    speed?: number;
    activeSets?: string[];

    // Supporter(Offensive) specific
    attack?: number;
}

export const SIMULATION_ITERATIONS = 1000;

export function runSimulation(
    stats: BaseStats,
    role: ShipTypeName | null,
    activeSets?: string[]
): SimulationSummary {
    switch (role) {
        case 'DEFENDER':
        case 'DEFENDER_SECURITY':
            return {
                ...runDefenderSimulation(stats),
                activeSets: activeSets,
            };
        case 'DEBUFFER':
        case 'DEBUFFER_DEFENSIVE':
        case 'DEBUFFER_BOMBER':
            return runDebufferSimulation(stats);
        case 'SUPPORTER':
            return runHealingSimulation(stats);
        case 'SUPPORTER_BUFFER':
            return {
                ...runDefenderSimulation(stats),
                speed: stats.speed,
                activeSets: activeSets,
            };
        case 'SUPPORTER_OFFENSIVE':
            return {
                speed: stats.speed,
                activeSets: activeSets,
                attack: stats.attack,
            };
        default:
            return runDamageSimulation(stats);
    }
}

export function runDamageSimulation(stats: BaseStats): SimulationSummary {
    let totalDamage = 0;
    let highest = 0;
    let lowest = Infinity;
    let critCount = 0;

    for (let i = 0; i < SIMULATION_ITERATIONS; i++) {
        const damage = calculateDamage(stats);
        totalDamage += damage;
        highest = Math.max(highest, damage);
        lowest = Math.min(lowest, damage);
        if (damage > stats.attack) {
            critCount++;
        }
    }

    return {
        averageDamage: Math.round(totalDamage / SIMULATION_ITERATIONS),
        highestHit: Math.round(highest),
        lowestHit: Math.round(lowest),
        critRate: Math.round((critCount / SIMULATION_ITERATIONS) * 100) / 100,
    };
}

function runDefenderSimulation(stats: BaseStats): SimulationSummary {
    const damageReduction = calculateDamageReduction(stats.defence || 0);
    const effectiveHP = (stats.hp || 0) * (100 / (100 - damageReduction));
    let survivalRounds = 0;
    // Calculate average damage taken per hit, now from multiple enemies
    const damagePerRound = ENEMY_ATTACK * ENEMY_COUNT;

    // Calculate shield generation
    const shieldPerRound = stats.shield
        ? Math.min((stats.hp || 0) * (stats.shield / 100), stats.hp || 0)
        : 0;

    // Calculate healing per hit, now multiplied by number of enemies
    const healingPerHit = stats.hpRegen ? calculateHealingPerHit(stats) : 0;
    const healingPerRound = healingPerHit * ENEMY_COUNT;
    const healingWithShieldPerRound = healingPerRound + shieldPerRound;

    // Calculate survival rounds
    // If healing >= damage, technically infinite survival
    if (healingWithShieldPerRound >= damagePerRound) {
        survivalRounds = Number.MAX_SAFE_INTEGER;
    } else {
        // Recalculate effective survivability including shield and healing against multiple enemies
        survivalRounds = effectiveHP / (damagePerRound - healingWithShieldPerRound);
    }
    return {
        effectiveHP: Math.round(effectiveHP),
        damageReduction: Math.round(damageReduction * 100) / 100,
        shieldPerRound: Math.round(shieldPerRound),
        healingPerHit: Math.round(healingPerHit),
        survivedRounds: survivalRounds,
        hp: stats.hp,
        hpRegen: stats.hpRegen,
        security: stats.security,
    };
}

function runDebufferSimulation(stats: BaseStats): SimulationSummary {
    const hacking = stats.hacking || 0;

    // Success rate is the difference between hacking and security as a percentage
    const hackSuccessRate = Math.min(100, Math.max(0, hacking - ENEMY_SECURITY));

    // Also run damage simulation as secondary output
    const damageSimulation = runDamageSimulation(stats);

    return {
        hackSuccessRate: Math.round(hackSuccessRate * 100) / 100,
        averageDamage: damageSimulation.averageDamage,
        highestHit: damageSimulation.highestHit,
        lowestHit: damageSimulation.lowestHit,
        critRate: damageSimulation.critRate,
    };
}

function runHealingSimulation(stats: BaseStats): SimulationSummary {
    let totalHealing = 0;
    let highest = 0;
    let lowest = Infinity;
    let critCount = 0;

    const baseHealing = (stats.hp || 0) * BASE_HEAL_PERCENT;
    const healModifier = 1 + (stats.healModifier || 0) / 100;

    for (let i = 0; i < SIMULATION_ITERATIONS; i++) {
        const healing = calculateHealing(baseHealing, healModifier, stats);
        totalHealing += healing;
        highest = Math.max(highest, healing);
        lowest = Math.min(lowest, healing);
        if (healing > baseHealing) {
            critCount++;
        }
    }

    return {
        averageHealing: Math.round(totalHealing / SIMULATION_ITERATIONS),
        highestHeal: Math.round(highest),
        lowestHeal: Math.round(lowest),
        critRate: Math.round((critCount / SIMULATION_ITERATIONS) * 100) / 100,
    };
}

function calculateDamage(stats: BaseStats): number {
    const baseDamage = stats.attack || 0;
    const critRoll = Math.random() * 100;
    const isCrit = critRoll <= (stats.crit || 0);

    if (isCrit) {
        return baseDamage * (1 + (stats.critDamage || 0) / 100);
    }
    return baseDamage;
}

function calculateHealing(baseHealing: number, healModifier: number, stats: BaseStats): number {
    const critRoll = Math.random() * 100;
    const isCrit = critRoll <= (stats.crit || 0);

    let healing = baseHealing;
    if (isCrit) {
        healing = baseHealing * (1 + (stats.critDamage || 0) / 100);
    }

    return healing * healModifier;
}
