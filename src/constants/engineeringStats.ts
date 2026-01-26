import { StatName } from '../types/stats';
import { ShipTypeName } from './shipTypes';

// Base roles that have engineering stats (subtypes inherit from these)
export type BaseRoleName = 'ATTACKER' | 'DEFENDER' | 'DEBUFFER' | 'SUPPORTER';

// 4 engineering stats per base role (order matches game UI)
export const ENGINEERING_STATS_BY_ROLE: Record<BaseRoleName, StatName[]> = {
    SUPPORTER: ['hacking', 'hp', 'security', 'defence'],
    ATTACKER: ['hacking', 'defence', 'critDamage', 'attack'],
    DEBUFFER: ['attack', 'security', 'hp', 'hacking'],
    DEFENDER: ['defence', 'hp', 'hacking', 'security'],
};

// Cumulative cost table (index = level, max level 20)
export const ENGINEERING_CUMULATIVE_COSTS = [
    0, // level 0 (no investment)
    100, // level 1
    250, // level 2
    450, // level 3
    700, // level 4
    1050, // level 5
    1500, // level 6
    2100, // level 7
    3000, // level 8
    4200, // level 9
    5900, // level 10
    8400, // level 11
    11600, // level 12
    16000, // level 13
    22000, // level 14
    30200, // level 15
    42200, // level 16
    57200, // level 17
    77200, // level 18
    107200, // level 19
    147200, // level 20
] as const;

export const MAX_ENGINEERING_LEVEL = 20;

/**
 * Get the cost to upgrade from currentLevel to currentLevel + 1
 */
export function getUpgradeCost(currentLevel: number): number {
    if (currentLevel >= MAX_ENGINEERING_LEVEL) return 0;
    if (currentLevel < 0) return ENGINEERING_CUMULATIVE_COSTS[1];
    return (
        ENGINEERING_CUMULATIVE_COSTS[currentLevel + 1] - ENGINEERING_CUMULATIVE_COSTS[currentLevel]
    );
}

/**
 * Extract the base role from any role variant
 * e.g., DEBUFFER_BOMBER -> DEBUFFER
 */
export function getBaseRole(role: ShipTypeName): BaseRoleName {
    if (role.startsWith('DEFENDER')) return 'DEFENDER';
    if (role.startsWith('DEBUFFER')) return 'DEBUFFER';
    if (role.startsWith('SUPPORTER')) return 'SUPPORTER';
    return 'ATTACKER';
}

/**
 * Get the stat increment per level for a given stat
 * Percentage stats: +1% per level
 * Flat stats (hacking, security): +2 per level
 */
export function getStatIncrement(statName: StatName): number {
    if (statName === 'hacking' || statName === 'security') {
        return 2;
    }
    return 1;
}

/**
 * Check if a stat is a flat stat (hacking, security) or percentage stat
 */
export function isEngineeringFlatStat(statName: StatName): boolean {
    return statName === 'hacking' || statName === 'security';
}
