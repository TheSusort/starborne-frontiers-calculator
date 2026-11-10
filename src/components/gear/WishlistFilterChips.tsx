import { getGearSet } from '../../constants/gearSets';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { RARITIES } from '../../constants/rarities';
import { WishlistEntry } from '../../types/wishlist';
import { wishlistStatLabel } from '../../utils/wishlist/describeWishlistEntry';

/** One chip per active filter of a wishlist entry. */
export function WishlistFilterChips({ entry }: { entry: WishlistEntry }) {
    const chips: string[] = [];
    const { filters } = entry;
    if (filters.slot?.length) chips.push(...filters.slot.map((s) => GEAR_SLOTS[s]?.label ?? s));
    if (filters.stars?.length) chips.push(...filters.stars.map((n) => `${n}★`));
    if (filters.rarity?.length) chips.push(...filters.rarity.map((r) => RARITIES[r]?.label ?? r));
    if (filters.setBonus?.length)
        chips.push(...filters.setBonus.map((s) => getGearSet(s)?.name ?? s));
    if (filters.mainStat?.length) {
        chips.push(`Main: ${filters.mainStat.map(wishlistStatLabel).join(' / ')}`);
    }
    if (filters.subStats?.length) {
        const names = filters.subStats.map(wishlistStatLabel).join(' + ');
        const min = filters.subStatsMin ?? filters.subStats.length;
        chips.push(min < filters.subStats.length ? `Subs: ${min} of ${names}` : `Subs: ${names}`);
    }

    if (chips.length === 0) {
        return <p className="text-xs text-theme-text-secondary">No filters — matches everything</p>;
    }

    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {chips.map((chip) => (
                <span
                    key={chip}
                    className="text-xs px-2 py-0.5 bg-dark-lighter border border-dark-border text-theme-text-secondary"
                >
                    {chip}
                </span>
            ))}
        </div>
    );
}
