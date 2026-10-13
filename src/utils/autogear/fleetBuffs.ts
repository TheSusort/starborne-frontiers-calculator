import { PERCENTAGE_ONLY_STATS, type BaseStats, type StatName } from '../../types/stats';
import type { FleetBuff } from '../../types/autogear';

const PERCENTAGE_ONLY_SET = new Set<StatName>(PERCENTAGE_ONLY_STATS);

export function applyFleetBuffs(stats: BaseStats, buffs: FleetBuff[]): BaseStats {
    if (buffs.length === 0) return stats;
    const modified: BaseStats = { ...stats };
    // Buffs on one stat add; the sum is applied once.
    const totals = new Map<StatName, number>();
    for (const buff of buffs) {
        totals.set(buff.stat, (totals.get(buff.stat) ?? 0) + buff.percentage);
    }
    for (const [stat, pct] of totals) {
        const current = modified[stat];
        if (typeof current !== 'number') continue;
        (modified as Record<StatName, number>)[stat] = PERCENTAGE_ONLY_SET.has(stat)
            ? current + pct
            : current * (1 + pct / 100);
    }
    return modified;
}
