import { ArenaSeasonRule } from '../../types/arena';
import { BaseStats } from '../../types/stats';

/**
 * Check if a rule matches a ship based on faction, rarity, and role.
 * Null/empty arrays mean "match all".
 */
export function matchesRule(
    rule: ArenaSeasonRule,
    shipFaction: string,
    shipRarity: string,
    shipRole: string
): boolean {
    if (rule.factions && rule.factions.length > 0 && !rule.factions.includes(shipFaction)) {
        return false;
    }
    if (rule.rarities && rule.rarities.length > 0 && !rule.rarities.includes(shipRarity)) {
        return false;
    }
    if (rule.ship_types && rule.ship_types.length > 0 && !rule.ship_types.includes(shipRole)) {
        return false;
    }
    return true;
}

/**
 * Get the summed modifiers from all matching rules for a specific ship.
 */
export function getMatchingModifiers(
    rules: ArenaSeasonRule[],
    shipFaction: string,
    shipRarity: string,
    shipRole: string
): Record<string, number> {
    const summed: Record<string, number> = {};

    for (const rule of rules) {
        if (!matchesRule(rule, shipFaction, shipRarity, shipRole)) continue;

        for (const [stat, value] of Object.entries(rule.modifiers)) {
            summed[stat] = (summed[stat] || 0) + value;
        }
    }

    return summed;
}

/**
 * Apply arena modifiers to total stats.
 * Formula: modifiedStat = totalStat * (1 + modifier / 100)
 */
export function applyArenaModifiers(
    stats: BaseStats,
    modifiers: Record<string, number>
): BaseStats {
    const entries = Object.entries(modifiers);
    if (entries.length === 0) return stats;

    const modified = { ...stats } as unknown as Record<string, number>;
    const original = stats as unknown as Record<string, number>;
    for (const [stat, percentage] of entries) {
        if (stat in modified) {
            modified[stat] = original[stat] * (1 + percentage / 100);
        }
    }
    return modified as unknown as BaseStats;
}
