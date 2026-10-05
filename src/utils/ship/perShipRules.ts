import { Refit } from '../../types/ship';
import { createStat } from './gameStatVocabulary';

/**
 * Stats a few named ships have that no data source carries — neither a player's exported play
 * data nor the official unit catalogue's `ascensionStats`. Both the import path and the
 * simulator's reference ships read them here, so an owned Asphodel and a reference Asphodel
 * cannot end up with different kits.
 */

/** Repair-per-hit, absent from every export. Planner-internal: never shown to players. */
export const getHpRegen = (name: string): number => {
    if (name === 'Isha') return 5;
    if (name === 'Heliodor') return 8;
    return 0;
};

/** Iridium's passive damage reduction, which its second refit unlocks. */
export const getDamageReduction = (name: string, refitCount: number): number =>
    name === 'Iridium' && refitCount >= 2 ? 35 : 0;

/**
 * "This Unit's attacks always critically hit": Tormenter's first passive carries it, so he has it
 * at every refit; Asphodel gets it with her second refit. No data source carries the crit, so it
 * is topped up to 100 — on the first refit when the ship has one (counting any crit the refits
 * already carry), otherwise on the base stats.
 *
 * Mutates `refits` (or `baseStats.crit`) in place and returns `refits`.
 */
export const applyGuaranteedCrit = (
    name: string,
    refitCount: number,
    refits: Refit[],
    baseStats: { crit: number }
): Refit[] => {
    const guaranteed = name === 'Tormenter' || (name === 'Asphodel' && refitCount >= 2);
    if (!guaranteed) return refits;
    if (refits.length > 0) {
        const refitCrit = refits
            .flatMap((refit) => refit.stats)
            .filter((stat) => stat.name === 'crit')
            .reduce((sum, stat) => sum + stat.value, 0);
        const topUp = 100 - baseStats.crit - refitCrit;
        if (topUp > 0) refits[0].stats.push(createStat('crit', topUp, 'percentage'));
    } else {
        baseStats.crit = 100;
    }
    return refits;
};

/**
 * A refit with no stats at all is given an inert one, matching what the import writes, so an
 * owned ship and a reference ship of the same unit have the same refit shape.
 */
export const padEmptyRefits = (refits: Refit[]): Refit[] => {
    refits.forEach((refit) => {
        if (refit.stats.length === 0) {
            refit.stats.push(createStat('attack', 0, 'flat'));
        }
    });
    return refits;
};
