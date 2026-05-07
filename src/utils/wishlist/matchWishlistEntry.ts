import { GearPiece } from '../../types/gear';
import { WishlistEntry } from '../../types/wishlist';

export function matchesWishlistEntry(gear: GearPiece, entry: WishlistEntry): boolean {
    const { filters } = entry;

    if (filters.slot !== undefined && gear.slot !== filters.slot) return false;
    if (filters.stars !== undefined && gear.stars < filters.stars) return false;
    if (filters.rarity !== undefined && gear.rarity !== filters.rarity) return false;
    if (filters.setBonus !== undefined && gear.setBonus !== filters.setBonus) return false;
    if (filters.mainStat !== undefined) {
        if (!gear.mainStat || gear.mainStat.name !== filters.mainStat.name) return false;
    }
    if (filters.subStats !== undefined && filters.subStats.length > 0) {
        if (gear.subStats.length === 0) return false;
        const pieceSubStatNames = new Set(gear.subStats.map((s) => s.name));
        if (!filters.subStats.every((f) => pieceSubStatNames.has(f.name))) return false;
    }

    return true;
}
