import type { ShipTypeName } from '../constants/shipTypes';
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../types/autogear';
import type {
    CommunityRecommendation,
    SharedAutogearBuild,
} from '../types/communityRecommendation';
import { validateSharedAutogearBuild } from '../schemas/sharedAutogearBuild';

/** The build-shaping slice of the autogear page's per-ship config. */
export interface AutogearBuildFields {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs?: FleetBuff[];
    excludedImplantTypes?: string[];
    optimizeImplants?: boolean;
}

/** A community recommendation resolved into something the UI can render. */
export interface CommunityBuild {
    id: string;
    shipName: string;
    shipRefitLevel: number;
    title: string;
    description?: string;
    isImplantSpecific: boolean;
    ultimateImplant?: string;
    upvotes: number;
    downvotes: number;
    score: number;
    createdAt: string;
    build: SharedAutogearBuild;
    /** True when the build was synthesised from the pre-2026-08-29 columns. */
    isLegacy: boolean;
}

export type CommunityBuildSort = 'top' | 'newest';

/**
 * Resolve a database row into a CommunityBuild.
 *
 * Prefers `shared_config`. Falls back to the legacy ship_role/stat_priorities/
 * stat_bonuses/set_priorities columns when it is absent OR fails validation —
 * a corrupt payload must degrade, not throw. Returns null when the legacy
 * columns cannot be validated either, in which case the caller drops the row.
 */
export const toCommunityBuild = (row: CommunityRecommendation): CommunityBuild | null => {
    const meta = {
        id: row.id,
        shipName: row.ship_name,
        shipRefitLevel: row.ship_refit_level ?? 0,
        title: row.title,
        description: row.description,
        isImplantSpecific: !!row.is_implant_specific,
        ultimateImplant: row.ultimate_implant,
        upvotes: row.upvotes ?? 0,
        downvotes: row.downvotes ?? 0,
        score: row.score ?? 0,
        createdAt: row.created_at,
    };

    const fromSharedConfig = validateSharedAutogearBuild(row.shared_config);
    if (fromSharedConfig) {
        return { ...meta, build: fromSharedConfig, isLegacy: false };
    }

    const fromLegacy = validateSharedAutogearBuild({
        version: 1,
        shipRole: row.ship_role,
        statPriorities: row.stat_priorities ?? [],
        setPriorities: row.set_priorities ?? [],
        statBonuses: row.stat_bonuses ?? [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
    });
    if (fromLegacy) {
        return { ...meta, build: fromLegacy, isLegacy: true };
    }

    console.warn(`Dropping unusable community recommendation ${row.id}`);
    return null;
};

/** True when this build is tagged for the ultimate implant the ship has equipped. */
export const isImplantMatch = (
    build: CommunityBuild,
    equippedUltimateImplant: string | null
): boolean =>
    build.isImplantSpecific &&
    !!equippedUltimateImplant &&
    build.ultimateImplant === equippedUltimateImplant;

// 0 = tagged for my implant, 1 = generic, 2 = tagged for a different implant.
const implantGroup = (build: CommunityBuild, equipped: string | null): number => {
    if (isImplantMatch(build, equipped)) return 0;
    if (!build.isImplantSpecific) return 1;
    return 2;
};

/**
 * Group by implant relevance, then order within each group by the chosen sort.
 * Implant grouping always applies and is not user-controllable — a build for a
 * different ultimate implant stays visible, just last.
 */
export const sortCommunityBuilds = (
    builds: CommunityBuild[],
    equippedUltimateImplant: string | null,
    sort: CommunityBuildSort
): CommunityBuild[] =>
    [...builds].sort((a, b) => {
        const groupDelta =
            implantGroup(a, equippedUltimateImplant) - implantGroup(b, equippedUltimateImplant);
        if (groupDelta !== 0) return groupDelta;

        if (sort === 'newest') {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }

        if (b.score !== a.score) return b.score - a.score;
        const votesDelta = b.upvotes + b.downvotes - (a.upvotes + a.downvotes);
        if (votesDelta !== 0) return votesDelta;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

/** Build the shareable payload from the page's per-ship config. Null without a role. */
export const configToSharedBuild = (config: AutogearBuildFields): SharedAutogearBuild | null => {
    if (!config.shipRole) return null;
    return {
        version: 1,
        shipRole: config.shipRole,
        statPriorities: config.statPriorities,
        setPriorities: config.setPriorities,
        statBonuses: config.statBonuses,
        fleetBuffs: config.fleetBuffs ?? [],
        excludedImplantTypes: config.excludedImplantTypes ?? [],
        optimizeImplants: config.optimizeImplants ?? false,
    };
};

/**
 * The exact update object for applying a community build to a ship's config.
 * Exactly these seven build-shaping fields — never the personal toggles
 * (algorithm, ignoreEquipped, ignoreUnleveled, useUpgradedStats,
 * tryToCompleteSets, includeCalibratedGear, assumeCalibrated, useArenaModifiers).
 * Those are absent from this object's keys, so a caller that spreads it over an
 * existing config cannot touch them.
 */
export interface CommunityBuildConfigUpdate {
    shipRole: ShipTypeName;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs: FleetBuff[];
    excludedImplantTypes: string[];
    optimizeImplants: boolean;
}

/** Adapts a shared community build into the page's per-ship config update shape. */
export const communityBuildToConfigUpdate = (
    build: SharedAutogearBuild
): CommunityBuildConfigUpdate => ({
    shipRole: build.shipRole,
    statPriorities: build.statPriorities,
    setPriorities: build.setPriorities,
    statBonuses: build.statBonuses,
    fleetBuffs: build.fleetBuffs,
    excludedImplantTypes: build.excludedImplantTypes,
    optimizeImplants: build.optimizeImplants,
});

/**
 * Whether applying a build would overwrite something. shipRole is excluded on
 * purpose: it always defaults to the ship's own type, so it is never empty and
 * would make every config look non-empty.
 */
export const hasExistingBuildConfig = (config: AutogearBuildFields): boolean =>
    config.statPriorities.length > 0 ||
    config.setPriorities.length > 0 ||
    config.statBonuses.length > 0 ||
    (config.fleetBuffs?.length ?? 0) > 0 ||
    (config.excludedImplantTypes?.length ?? 0) > 0 ||
    config.optimizeImplants === true;
