import type { Ship } from '../../../types/ship';
import type { BaseStats, EngineeringStat, Stat } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import { STAT_INDEX, baseStatsToStatVector, type StatVector } from '../../fastScoring/statVector';

/**
 * Compute the per-ship "constant prefix" (base + refits + engineering) as a
 * Float64Array. This is added to the per-individual gear/implant contributions
 * inside the hot loop.
 *
 * Mirrors the base -> afterRefits -> afterEngineering portion of
 * calculateTotalStats. Keep in sync.
 */
export function computeShipPrefix(
    ship: Ship,
    engineeringStats: EngineeringStat | undefined
): StatVector {
    const prefix = baseStatsToStatVector(ship.baseStats);

    // Refits: apply each stat against the current base stats (the slow path
    // does the same — afterRefits starts from baseStats).
    if (ship.refits) {
        for (const refit of ship.refits) {
            if (!refit.stats) continue;
            for (const stat of refit.stats) applyStat(stat, prefix, ship.baseStats);
        }
    }

    // Engineering: applied against the same baseStats (afterEngineering starts
    // from afterRefits, but percentage stats use baseStats — this matches
    // calculateTotalStats passing `baseStats` as the third arg to addStatModifier).
    if (engineeringStats?.stats) {
        for (const stat of engineeringStats.stats) applyStat(stat, prefix, ship.baseStats);
    }

    return prefix;
}

function applyStat(stat: Stat, target: StatVector, baseStats: BaseStats): void {
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;
    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += stat.value;
    } else if (stat.type === 'percentage') {
        const baseValue = (baseStats as unknown as Record<string, number>)[stat.name] ?? 0;
        target[idx] += baseValue * (stat.value / 100);
    } else {
        target[idx] += stat.value;
    }
}
