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
 * Asphodel and Tormenter crit on every hit once their second refit lands. The refit that grants
 * it carries no crit in any data source, so the top-up to 100 is written onto the first refit.
 *
 * Mutates `refits` in place and returns it.
 */
export const applyGuaranteedCrit = (
    name: string,
    refitCount: number,
    refits: Refit[],
    baseCrit: number
): Refit[] => {
    if ((name === 'Asphodel' || name === 'Tormenter') && refitCount >= 2 && refits.length > 0) {
        refits[0].stats.push(createStat('crit', 100 - baseCrit, 'percentage'));
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
