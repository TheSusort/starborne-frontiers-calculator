import type { ShipTypeName } from '../constants/shipTypes';
import { StatPriority, SetPriority, StatBonus, FleetBuff } from './autogear';

export interface CommunityRecommendation {
    id: string;
    ship_name: string;
    ship_refit_level: number;
    title: string;
    description?: string;
    is_implant_specific: boolean;
    ultimate_implant?: string;
    ship_role: string;
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
 * The portion of a SavedAutogearConfig that is shared with the community.
 *
 * Deliberately excludes the personal toggles (algorithm, ignoreEquipped,
 * ignoreUnleveled, useUpgradedStats, tryToCompleteSets, includeCalibratedGear,
 * assumeCalibrated, useArenaModifiers) — those describe the sharer's own
 * inventory and preferences, not the build.
 *
 * `version` exists so a future shape change can be migrated on read.
 */
export interface SharedAutogearBuild {
    version: 1;
    shipRole: ShipTypeName;
    /** Order IS the priority — StatPriority.weight is hardcoded to 1 everywhere. */
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs: FleetBuff[];
    excludedImplantTypes: string[];
    optimizeImplants: boolean;
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
