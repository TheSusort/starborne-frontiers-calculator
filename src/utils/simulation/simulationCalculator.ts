import { BaseStats } from '../../types/stats';
import { ShipTypeName } from '../../constants';
import { calculateDamageReduction } from '../autogear/scoring';

export interface SimulationSummary {
    // Common
    averageDamage?: number;
    highestHit?: number;
    lowestHit?: number;
    critRate?: number;

    // Defender specific
    effectiveHP?: number;
    attacksWithstood?: number;
    damageReduction?: number;

    // Debuffer specific
    hackSuccessRate?: number;

    // Supporter specific
    averageHealing?: number;
    highestHeal?: number;
    lowestHeal?: number;

    // Supporter(Buffer) specific
    speed?: number;
    activeSets?: string[];
}

const SIMULATION_ITERATIONS = 1000;
const ENEMY_ATTACK = 15000; // For defender simulations
const ENEMY_SECURITY = 170; // For debuffer simulations
const BASE_HEAL_PERCENT = 0.15; // 15% of max HP

export function runSimulation(
    stats: BaseStats,
    role: ShipTypeName | null,
    activeSets?: string[]
): SimulationSummary {
    switch (role) {
        case 'Attacker':
            return runDamageSimulation(stats);
        case 'Defender':
            return runDefenderSimulation(stats);
        case 'Debuffer':
            return runDebufferSimulation(stats);
        case 'Supporter':
            return runHealingSimulation(stats);
        case 'Supporter(Buffer)':
            return {
                ...runDefenderSimulation(stats),
                speed: stats.speed,
                activeSets: activeSets,
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

    // Calculate average damage taken per hit
    const averageDamageTaken = ENEMY_ATTACK * ((100 - damageReduction) / 100);
    const attacksWithstood = Math.floor(effectiveHP / averageDamageTaken);

    return {
        effectiveHP: Math.round(effectiveHP),
        attacksWithstood,
        damageReduction: Math.round(damageReduction * 100) / 100,
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
