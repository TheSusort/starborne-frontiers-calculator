import { SHIP_TYPES, type ShipTypeName } from '../constants/shipTypes';
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../types/autogear';
import type {
    CommunityRecommendation,
    SharedAutogearBuild,
} from '../types/communityRecommendation';
import { validateSharedAutogearBuild } from '../schemas/sharedAutogearBuild';

const SHIP_TYPE_KEYS = Object.keys(SHIP_TYPES);

// Not a type predicate: `ShipTypeName` is `keyof typeof SHIP_TYPES`, and
// SHIP_TYPES' explicit `Record<string, ShipType>` annotation makes that
// `string | number` at the type level (satisfies doesn't narrow an already
// -annotated type) — a `key is ShipTypeName` guard would make TS compute
// `Exclude<string, ShipTypeName>` in the negative branch, which collapses to
// `never`. Cast at each call site instead.
const isShipTypeKey = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(SHIP_TYPES, key);

/**
 * Normalise a legacy `ship_role` display label (e.g. `'DEBUFFER (Corrosion)'`,
 * the text the old UI showed) into a `SHIP_TYPES` key, or null when nothing
 * resolves.
 *
 * Real production `ship_role` values include: 'DEBUFFER (Corrosion)',
 * 'DEFENDER (Security)', 'DEFENDER(SECURITY)', 'SUPPORTER (Offensive)', and
 * the bare qualifier 'CORROSION'. All five are recovered by this function.
 *
 * Resolution order:
 * 1. Uppercase; collapse spaces/parens/any non-alphanumeric run to a single
 *    underscore; trim leading/trailing underscores.
 * 2. Exact match against a SHIP_TYPES key.
 * 3. Bare-qualifier fallback: if exactly one SHIP_TYPES key ends with
 *    `_<normalised>`, use it (recovers 'CORROSION' -> 'DEBUFFER_CORROSION').
 *    Checked dynamically against the real key list, not hardcoded, so an
 *    ambiguous qualifier (matching more than one key) safely falls through
 *    instead of guessing.
 * 4. Progressive-prefix fallback: drop trailing `_SEGMENTS` one at a time and
 *    use the first prefix that is a valid key (so a future
 *    'DEBUFFER_SOMETHINGNEW' degrades to 'DEBUFFER').
 * 5. Otherwise null — the caller drops the row, as it does today.
 */
export const normalizeShipRole = (raw: string): ShipTypeName | null => {
    const normalised = raw
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (!normalised) return null;
    if (isShipTypeKey(normalised)) return normalised;

    const suffixMatches = SHIP_TYPE_KEYS.filter((key) => key.endsWith(`_${normalised}`));
    if (suffixMatches.length === 1) return suffixMatches[0];

    const segments = normalised.split('_');
    for (let keep = segments.length - 1; keep > 0; keep--) {
        const prefix = segments.slice(0, keep).join('_');
        if (isShipTypeKey(prefix)) return prefix;
    }

    return null;
};

/**
 * Legacy `stat_bonuses` rows may use the shape of the old, now-deleted
 * `AIRecommendation` type: `{ stat, weight }` instead of `{ stat, percentage }`.
 * Map `weight` forward only when `percentage` is absent — never accepted by
 * the schema itself, only adapted here on the way in.
 */
const normalizeLegacyStatBonuses = (raw: unknown): unknown => {
    if (!Array.isArray(raw)) return raw;
    return raw.map((entry) => {
        if (entry && typeof entry === 'object' && !('percentage' in entry) && 'weight' in entry) {
            const { weight, ...rest } = entry as Record<string, unknown>;
            return { ...rest, percentage: weight };
        }
        return entry;
    });
};

/** Applied piece count for a legacy set priority with no recorded count —
 *  SetPriorityForm's own default and the smallest real gear-set bonus, so it
 *  is the conservative reading. Shared with the Apply confirmation copy so
 *  the UI and the applied value never drift apart. */
export const LEGACY_DEFAULT_SET_COUNT = 2;

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

    const normalizedShipRole = normalizeShipRole(row.ship_role);
    if (!normalizedShipRole) {
        console.warn(
            `Could not normalise ship_role "${row.ship_role}" for community recommendation ${row.id}`
        );
    }

    const fromLegacy = validateSharedAutogearBuild({
        version: 1,
        // Fall back to the raw value when normalisation fails so validation —
        // and the drop-the-row behaviour below — happens exactly as before.
        shipRole: normalizedShipRole ?? row.ship_role,
        statPriorities: row.stat_priorities ?? [],
        setPriorities: row.set_priorities ?? [],
        statBonuses: normalizeLegacyStatBonuses(row.stat_bonuses ?? []),
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

/**
 * Adapts a shared community build into the page's per-ship config update
 * shape. The page config needs a concrete piece count for every set
 * priority, so a legacy build with no recorded count (SharedSetPriority)
 * is filled with LEGACY_DEFAULT_SET_COUNT here — the one place the shared
 * build's optional `count` becomes the engine's required one.
 */
export const communityBuildToConfigUpdate = (
    build: SharedAutogearBuild
): CommunityBuildConfigUpdate => ({
    shipRole: build.shipRole,
    statPriorities: build.statPriorities,
    setPriorities: build.setPriorities.map((set) => ({
        ...set,
        count: set.count ?? LEGACY_DEFAULT_SET_COUNT,
    })),
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
