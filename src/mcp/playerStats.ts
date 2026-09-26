import type { BaseStats } from '../types/stats';

/** A ship's stats as a player reads them. `hpRegen` is dropped: it is the planner's model of
 *  hit-triggered self-repair, not a stat the game has, so it is never shown to a player. */
export const playerStats = (stats: BaseStats): Omit<BaseStats, 'hpRegen'> => {
    const { hpRegen: _plannerInternal, ...shown } = stats;
    return shown;
};
