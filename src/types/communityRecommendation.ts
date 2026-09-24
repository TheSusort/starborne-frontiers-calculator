import type { ShipTypeName } from '../constants/shipTypes';
import {
    StatPriority,
    SetPriority,
    StatBonus,
    FleetBuff,
    CustomFormula,
    RoleBasis,
} from './autogear';

export interface CommunityRecommendation {
    id: string;
    ship_name: string;
    ship_refit_level: number;
    title: string;
    description?: string;
    is_implant_specific: boolean;
    ultimate_implant?: string;
    /** Null for a Custom-mode build with no role to mirror (a from-scratch formula, i.e. no
     *  seededFrom) — see `mirroredShipRole` in `src/utils/communityBuild.ts`. The database
     *  column itself is NOT NULL today; a null value here appears only once #552 relaxes it
     *  to nullable in the same change that turns on `ALLOW_ROLELESS_COMMUNITY_SHARE`. */
    ship_role: string | null;
    stat_priorities: StatPriority[];
    stat_bonuses: StatBonus[];
    set_priorities: SetPriority[];
    reasoning?: string;
    upvotes: number;
    downvotes: number;
    total_votes: number;
    score: number;
    created_by?: string;
    created_at: string;
    updated_at?: string;
    /** Present on rows written after the 2026-08-29 migration; null on older rows. */
    shared_config?: unknown;
}

/**
 * A SetPriority as carried in a shared build. Same shape as the engine's
 * SetPriority, except `count` is optional: a legacy recommendation row
 * written before piece counts were captured has no recorded value, and the
 * decision is to show it without inventing one (e.g. "Decimation", not
 * "Decimation ( 2 pieces)"). The autogear engine's own SetPriority
 * (types/autogear.ts) keeps `count` required — only the shared/display shape
 * relaxes it. A build shared from the current UI always has a real count, so
 * this is purely additive for the new write path.
 */
export type SharedSetPriority = Omit<SetPriority, 'count'> & { count?: number };

/**
 * The portion of a SavedAutogearConfig that is shared with the community.
 *
 * Deliberately excludes the personal toggles (algorithm, ignoreEquipped,
 * ignoreUnleveled, useUpgradedStats, tryToCompleteSets, includeCalibratedGear,
 * assumeCalibrated, useArenaModifiers) — those describe the sharer's own
 * inventory and preferences, not the build.
 *
 * `version` exists so a future shape change can be migrated on read. A `version: 1` row has a
 * non-null `shipRole` and no `customFormula` — a plain role build, still written for every such
 * build so production's live bundle (a `version: 1`-only reader) keeps reading it in full.
 * `version: 2` adds Custom mode: `shipRole: null` plus a `customFormula` whose core row carries
 * a weighted `basis`, so the formula (not a stat limit) is what travels — it generalises across
 * the recipient's own inventory. `roleBasis`, a transcription of the sharer's own kit that
 * replaces a role's primary scoring quantity (see `RoleBasis` in `types/autogear.ts`), can ride
 * on either version.
 */
export interface SharedAutogearBuild {
    version: 1 | 2;
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SharedSetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs: FleetBuff[];
    excludedImplantTypes: string[];
    optimizeImplants: boolean;
    /** Only ever present on a `version: 2` build (Custom mode, `shipRole: null` or a
     *  role-seeded formula). */
    customFormula?: CustomFormula;
    /** Applies only where the shared `shipRole` hosts this basis's `produces` axis
     *  (`roleHostsBasis`, `offFormula/roleBasisHost.ts`). Present on either version. */
    roleBasis?: RoleBasis;
}

export interface CreateCommunityRecommendationInput {
    shipName: string;
    shipRefitLevel: number;
    title: string;
    description?: string;
    isImplantSpecific: boolean;
    ultimateImplant?: string;
    /** The full shared build. Its fields are also mirrored into the legacy columns. */
    sharedConfig: SharedAutogearBuild;
}
