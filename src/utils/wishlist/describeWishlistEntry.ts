import { GEAR_SLOTS } from '../../constants/gearTypes';
import { RARITIES } from '../../constants/rarities';
import { getGearSet } from '../../constants/gearSets';
import { STATS } from '../../constants/stats';
import { StatName, StatType } from '../../types/stats';
import { WishlistEntry } from '../../types/wishlist';
import { requiredSubStats } from './matchWishlistEntry';

export const WISHLIST_NAME_MAX_LENGTH = 64;

/** Short stat label, with a `%` suffix when the stat has both flat and percentage forms. */
export function wishlistStatLabel({ name, type }: { name: StatName; type?: StatType }): string {
    const def = STATS[name];
    if (!def) return name;
    if (type === 'percentage' && def.allowedTypes.length > 1) return `${def.shortLabel}%`;
    return def.shortLabel;
}

/** Name for an entry saved without one, e.g. `6★ Legendary Weapon · ATK% + CR`. */
export function describeWishlistEntry(filters: WishlistEntry['filters']): string {
    const head = [
        filters.stars?.length
            ? [...filters.stars]
                  .sort((a, b) => a - b)
                  .map((n) => `${n}★`)
                  .join('/')
            : '',
        filters.rarity?.map((r) => RARITIES[r]?.label ?? r).join('/') ?? '',
        filters.setBonus?.map((s) => getGearSet(s)?.name ?? s).join('/') ?? '',
        filters.slot?.map((s) => GEAR_SLOTS[s]?.label ?? s).join('/') ?? '',
    ]
        .filter(Boolean)
        .join(' ');

    const parts = [head];
    if (filters.mainStat?.length) {
        parts.push(`Main ${filters.mainStat.map(wishlistStatLabel).join('/')}`);
    }
    if (filters.subStats?.length) {
        const names = filters.subStats.map(wishlistStatLabel).join(' + ');
        const min = requiredSubStats(filters);
        parts.push(min < filters.subStats.length ? `${min} of ${names}` : names);
    }

    const name = parts.filter(Boolean).join(' · ');
    return (name || 'Any gear').slice(0, WISHLIST_NAME_MAX_LENGTH);
}
