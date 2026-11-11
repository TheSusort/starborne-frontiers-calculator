import { GearPiece } from '../../types/gear';
import { GearSetName } from '../../constants/gearSets';
import { isGearSlotName } from '../../constants/gearTypes';
import { WishlistEntry } from '../../types/wishlist';

/** A gear piece rolls at most this many substats. */
export const MAX_GEAR_SUBSTATS = 4;

/**
 * How many of `filters.subStats` a piece must roll: `subStatsMin`, or all of them when unset,
 * never more than a piece can hold (`MAX_GEAR_SUBSTATS`), so a list of five or more stays
 * matchable.
 */
export function requiredSubStats(filters: WishlistEntry['filters']): number {
    const count = filters.subStats?.length ?? 0;
    return Math.min(filters.subStatsMin ?? count, count, MAX_GEAR_SUBSTATS);
}

export function matchesWishlistEntry(gear: GearPiece, entry: WishlistEntry): boolean {
    const { filters } = entry;

    // `filters.slot` is gear-only (the wishlist form never offers an implant slot) — an
    // implant piece can never match a slot filter, only fall through when none is set.
    if (filters.slot !== undefined && filters.slot.length > 0) {
        if (!isGearSlotName(gear.slot) || !filters.slot.includes(gear.slot)) return false;
    }
    if (filters.stars !== undefined && filters.stars.length > 0) {
        if (!filters.stars.includes(gear.stars)) return false;
    }
    if (filters.rarity !== undefined && filters.rarity.length > 0) {
        if (!filters.rarity.includes(gear.rarity)) return false;
    }
    if (filters.setBonus !== undefined && filters.setBonus.length > 0) {
        if (!filters.setBonus.includes(gear.setBonus as GearSetName)) return false;
    }
    if (filters.mainStat !== undefined && filters.mainStat.length > 0) {
        if (!gear.mainStat) return false;
        if (
            !filters.mainStat.some(
                (f) =>
                    f.name === gear.mainStat!.name &&
                    (f.type === undefined || f.type === gear.mainStat!.type)
            )
        )
            return false;
    }
    if (filters.subStats !== undefined && filters.subStats.length > 0) {
        if (gear.subStats.length === 0) return false;
        const matched = filters.subStats.filter((f) =>
            gear.subStats.some(
                (s) => s.name === f.name && (f.type === undefined || f.type === s.type)
            )
        ).length;
        if (matched < requiredSubStats(filters)) return false;
    }

    return true;
}
