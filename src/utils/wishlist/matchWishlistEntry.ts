import { GearPiece } from '../../types/gear';
import { GearSetName } from '../../constants/gearSets';
import { WishlistEntry } from '../../types/wishlist';

export function matchesWishlistEntry(gear: GearPiece, entry: WishlistEntry): boolean {
    const { filters } = entry;

    if (filters.slot !== undefined && filters.slot.length > 0) {
        if (!filters.slot.includes(gear.slot)) return false;
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
        if (!gear.mainStat || !filters.mainStat.some((f) => f.name === gear.mainStat!.name))
            return false;
    }
    if (filters.subStats !== undefined && filters.subStats.length > 0) {
        if (gear.subStats.length === 0) return false;
        const pieceSubStatNames = new Set(gear.subStats.map((s) => s.name));
        const matched = filters.subStats.filter((f) => pieceSubStatNames.has(f.name)).length;
        const required = filters.subStatsMin ?? filters.subStats.length;
        if (matched < required) return false;
    }

    return true;
}
