import { BaseStats } from '../types/stats';
import { ShipTypeName } from '../constants';
import { calculateDamageReduction } from './autogear/scoring';

export interface SimulationSummary {
  // Common
  averageDamage?: number;
  highestHit?: number;
  lowestHit?: number;

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
}

const SIMULATION_ITERATIONS = 1000;
const ENEMY_ATTACK = 15000; // For defender simulations
const ENEMY_SECURITY = 170; // For debuffer simulations
const BASE_HEAL_PERCENT = 0.15; // 15% of max HP

export function runSimulation(stats: BaseStats, role: ShipTypeName | null): SimulationSummary {
  switch (role) {
    case 'Attacker':
      return runDamageSimulation(stats);
    case 'Defender':
      return runDefenderSimulation(stats);
    case 'Debuffer':
      return runDebufferSimulation(stats);
    case 'Supporter':
      return runHealingSimulation(stats);
    default:
      return runDamageSimulation(stats);
  }
}

export function runDamageSimulation(stats: BaseStats): SimulationSummary {
  let totalDamage = 0;
  let highest = 0;
  let lowest = Infinity;

  for (let i = 0; i < SIMULATION_ITERATIONS; i++) {
    const damage = calculateDamage(stats);
    totalDamage += damage;
    highest = Math.max(highest, damage);
    lowest = Math.min(lowest, damage);
  }

  return {
    averageDamage: Math.round(totalDamage / SIMULATION_ITERATIONS),
    highestHit: Math.round(highest),
    lowestHit: Math.round(lowest),
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
  const hackSuccessRate = Math.min(
    100,
    Math.max(0, (((stats.hacking || 0) - ENEMY_SECURITY) / ENEMY_SECURITY) * 100)
  );

  // Also run damage simulation as secondary output
  const damageSimulation = runDamageSimulation(stats);

  return {
    hackSuccessRate: Math.round(hackSuccessRate * 100) / 100,
    averageDamage: damageSimulation.averageDamage,
    highestHit: damageSimulation.highestHit,
    lowestHit: damageSimulation.lowestHit,
  };
}

function runHealingSimulation(stats: BaseStats): SimulationSummary {
  let totalHealing = 0;
  let highest = 0;
  let lowest = Infinity;

  const baseHealing = (stats.hp || 0) * BASE_HEAL_PERCENT;
  const healModifier = 1 + (stats.healModifier || 0) / 100;

  for (let i = 0; i < SIMULATION_ITERATIONS; i++) {
    const healing = calculateHealing(baseHealing, healModifier, stats);
    totalHealing += healing;
    highest = Math.max(highest, healing);
    lowest = Math.min(lowest, healing);
  }

  return {
    averageHealing: Math.round(totalHealing / SIMULATION_ITERATIONS),
    highestHeal: Math.round(highest),
    lowestHeal: Math.round(lowest),
  };
}

function calculateDamage(stats: BaseStats): number {
  const baseDamage = stats.attack || 0;
  const critRoll = Math.random() * 100;
  const isCrit = critRoll <= (stats.crit || 0);

  if (isCrit) {
    return baseDamage + baseDamage * ((stats.critDamage || 100) / 100);
  }
  return baseDamage;
}

function calculateHealing(baseHealing: number, healModifier: number, stats: BaseStats): number {
  const critRoll = Math.random() * 100;
  const isCrit = critRoll <= (stats.crit || 0);

  if (isCrit) {
    baseHealing += baseHealing * ((stats.critDamage || 100) / 100);
  }

  const healing = baseHealing * healModifier;

  return healing;
}
