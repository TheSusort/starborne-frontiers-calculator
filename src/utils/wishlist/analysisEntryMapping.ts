import type { GearSetName } from '../../constants/gearSets';
import type { RarityName } from '../../constants/rarities';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { StatName } from '../../types/stats';
import type { WishlistEntry } from '../../types/wishlist';

const ANALYSIS_RARITIES = ['rare', 'epic', 'legendary'] as const satisfies readonly RarityName[];

/** The Upgrade Analysis config fields an entry can be built from. */
export interface AnalysisConfig {
    shipId?: string;
    role?: ShipTypeName;
    stats: readonly StatName[];
    statFilterMode: 'AND' | 'OR';
    gearSets: readonly GearSetName[];
    /** Upgrade Analysis' rarity filter: this rarity and above. */
    minRarity: (typeof ANALYSIS_RARITIES)[number];
}

/**
 * The wishlist entry an Upgrade Analysis config describes, without a name (the form generates
 * one). A ship wins over a role; with neither there is nothing to target, so null.
 */
export function analysisConfigToWishlistDraft(
    config: AnalysisConfig
): Omit<WishlistEntry, 'id'> | null {
    const target: WishlistEntry['target'] = config.shipId
        ? { kind: 'ship', shipId: config.shipId }
        : config.role
          ? { kind: 'role', role: config.role }
          : undefined;
    if (!target) return null;

    const filters: WishlistEntry['filters'] = {
        rarity: ANALYSIS_RARITIES.slice(ANALYSIS_RARITIES.indexOf(config.minRarity)),
    };
    if (config.gearSets.length > 0) filters.setBonus = [...config.gearSets];
    if (config.stats.length > 0) {
        filters.subStats = config.stats.map((name) => ({ name }));
        // AND needs every stat; OR needs one. An omitted minimum means "all".
        if (config.statFilterMode === 'OR' && config.stats.length > 1) filters.subStatsMin = 1;
    }
    return { name: '', filters, target };
}

export interface AnalysisLink {
    shipId?: string;
    role?: ShipTypeName;
    stats?: StatName[];
    statFilterMode: 'AND' | 'OR';
    sets?: GearSetName[];
}

/** The Upgrade Analysis deep-link params a targeted entry opens; null for an untargeted one. */
export function wishlistEntryToAnalysisLink(
    entry: WishlistEntry,
    shipType?: ShipTypeName
): AnalysisLink | null {
    const { target, filters } = entry;
    if (!target) return null;
    const stats = filters.subStats?.map((s) => s.name);
    const needsAll = (filters.subStatsMin ?? stats?.length ?? 0) >= (stats?.length ?? 0);
    return {
        ...(target.kind === 'ship'
            ? { shipId: target.shipId, ...(shipType ? { role: shipType } : {}) }
            : { role: target.role }),
        ...(stats?.length ? { stats } : {}),
        statFilterMode: needsAll && (stats?.length ?? 0) > 1 ? 'AND' : 'OR',
        ...(filters.setBonus?.length ? { sets: [...filters.setBonus] } : {}),
    };
}
