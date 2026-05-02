import { PERCENTAGE_ONLY_STATS, type BaseStats, type StatName } from '../../types/stats';
import type { FleetBuff } from '../../types/autogear';

const PERCENTAGE_ONLY_SET = new Set<StatName>(PERCENTAGE_ONLY_STATS);

export function applyFleetBuffs(stats: BaseStats, buffs: FleetBuff[]): BaseStats {
    if (buffs.length === 0) return stats;
    const modified: BaseStats = { ...stats };
    for (const buff of buffs) {
        const current = modified[buff.stat];
        if (typeof current !== 'number') continue;
        if (PERCENTAGE_ONLY_SET.has(buff.stat)) {
            (modified as Record<StatName, number>)[buff.stat] = current + buff.percentage / 100;
        } else {
            (modified as Record<StatName, number>)[buff.stat] =
                current * (1 + buff.percentage / 100);
        }
    }
    return modified;
}
