import { PERCENTAGE_ONLY_STATS, type BaseStats, type StatName } from '../../types/stats';
import type { FleetBuff } from '../../types/autogear';

export function applyFleetBuffs(stats: BaseStats, buffs: FleetBuff[]): BaseStats {
    if (buffs.length === 0) return stats;
    const modified = { ...stats } as unknown as Record<string, number>;
    for (const buff of buffs) {
        if (typeof modified[buff.stat] !== 'number') continue;
        if ((PERCENTAGE_ONLY_STATS as readonly StatName[]).includes(buff.stat)) {
            modified[buff.stat] += buff.percentage / 100;
        } else {
            modified[buff.stat] *= 1 + buff.percentage / 100;
        }
    }
    return modified as unknown as BaseStats;
}
