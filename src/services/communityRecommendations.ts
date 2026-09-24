import { supabase } from '../config/supabase';
import {
    CommunityRecommendation,
    CreateCommunityRecommendationInput,
    SharedAutogearBuild,
} from '../types/communityRecommendation';
import {
    sharedAutogearBuildSchema,
    isSharedBuildBasisCapIssue,
} from '../schemas/sharedAutogearBuild';
import {
    mirroredShipRole,
    ALLOW_ROLELESS_COMMUNITY_SHARE,
    ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE,
    buildReferencesCritMultiplier,
} from '../utils/communityBuild';

/**
 * Thrown by createRecommendation when the shared config fails schema
 * validation, so callers can tell this apart from a not-signed-in / RLS
 * insert failure — both of which otherwise just resolve to `null`.
 */
export class InvalidSharedConfigError extends Error {
    constructor() {
        super('Invalid shared autogear build');
        this.name = 'InvalidSharedConfigError';
    }
}

/**
 * A more specific `InvalidSharedConfigError`, thrown by createRecommendation when the build is
 * rejected specifically for exceeding the schema's basis caps (more than `MAX_BASIS_TERMS`
 * terms in a `roleBasis`/`customFormula` row's `basis`, or a basis weight outside its allowed
 * range) — `isSharedBuildBasisCapIssue` tells this apart from any other validation failure, so
 * a caller that checks for it can name what to shrink rather than the generic "could not be
 * validated". Extends `InvalidSharedConfigError` (rather than `Error`) so an
 * `instanceof InvalidSharedConfigError` check written before this class existed still catches
 * it — the specific message is additive, not a silent behaviour change for that caller.
 */
export class SharedBuildExceedsBasisCapsError extends InvalidSharedConfigError {
    constructor() {
        super();
        this.message =
            'This equation has too many stats, or a weight too large or too small, to be shared.';
        this.name = 'SharedBuildExceedsBasisCapsError';
    }
}

/**
 * Thrown by createRecommendation when the shared build has no role to mirror into the legacy
 * `ship_role` column and role-less sharing is switched off (`ALLOW_ROLELESS_COMMUNITY_SHARE`).
 * `configToSharedBuild` already refuses this build for the app's own UI before it ever reaches
 * here — this is the same refusal for any other caller that builds a `SharedAutogearBuild`
 * directly and calls this service, so a null `ship_role` can never be written while the switch
 * is off, regardless of caller.
 */
export class RolelessShareNotAllowedError extends Error {
    constructor() {
        super('Sharing a build with no role is not available yet');
        this.name = 'RolelessShareNotAllowedError';
    }
}

/**
 * Thrown by createRecommendation when the shared build names `critMultiplier` (a stat
 * priority, a stat bonus, or a custom-formula row — `buildReferencesCritMultiplier`) and
 * `ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE` is off. Mirrors `RolelessShareNotAllowedError`: the
 * share UI (`CommunityRecommendations.tsx`) already withholds the Share button for such a
 * build, so this is the same refusal for any other caller that builds a `SharedAutogearBuild`
 * directly and calls this service.
 */
export class CritMultiplierShareNotAllowedError extends Error {
    constructor() {
        super('Sharing a build using Crit Multiplier is not available yet');
        this.name = 'CritMultiplierShareNotAllowedError';
    }
}

/**
 * Thrown by createRecommendation when the insert fails on a NOT NULL violation for
 * `ship_role` (Postgres code 23502) while writing a role-less build. This only fires when a
 * caller passes `allowRoleless: true` explicitly — `ALLOW_ROLELESS_COMMUNITY_SHARE` is off by
 * default, so `RolelessShareNotAllowedError` refuses a role-less build before insert is ever
 * attempted. `community_recommendations.ship_role` is NOT NULL today; #552 relaxes it to
 * nullable in the same change that turns that switch on. Until then, this error names a
 * role-less write rejected at the DB rather than silently dropped or crashing.
 */
export class ShipRoleColumnNotNullableError extends Error {
    constructor() {
        super('Sharing a build with no role requires a pending database migration');
        this.name = 'ShipRoleColumnNotNullableError';
    }
}

export class CommunityRecommendationService {
    /**
     * Every community recommendation for a ship, best-scored first.
     *
     * Implant relevance is applied client-side (sortCommunityBuilds) rather than
     * filtered in SQL, so a build tagged for a different ultimate implant stays
     * visible instead of disappearing.
     */
    static async listForShip(shipName: string): Promise<CommunityRecommendation[]> {
        const { data, error } = await supabase
            .from('community_recommendations')
            .select('*')
            .eq('ship_name', shipName)
            .order('score', { ascending: false })
            .order('total_votes', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching community recommendations:', error);
            return [];
        }

        return data || [];
    }

    static async createRecommendation(
        input: CreateCommunityRecommendationInput,
        // Authorship uses the active profile so alt accounts can share recommendations
        // independently. RLS allows any profile the auth user owns (has_profile_access).
        createdBy: string,
        // Mirrors `configToSharedBuild`'s own parameter: a default read from the switch, not a
        // module-level read baked into the function body, so both call patterns are testable
        // without mocking. `configToSharedBuild` already refuses a role-less build for the
        // app's own UI before it reaches here — this is the same refusal for any other caller
        // that builds a `SharedAutogearBuild` directly and calls this service (defence in
        // depth, so a null `ship_role` can never be written while the switch is off).
        allowRoleless: boolean = ALLOW_ROLELESS_COMMUNITY_SHARE,
        // Mirrors `allowRoleless` immediately above: a default read from the switch
        // (`ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE`), testable without mocking. The share UI
        // (`CommunityRecommendations.tsx`) already withholds the Share button for a build
        // naming `critMultiplier` — this is the same refusal for any other caller.
        allowCritMultiplier: boolean = ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE
    ): Promise<CommunityRecommendation | null> {
        // Parse directly (rather than through `validateSharedAutogearBuild`) so a failure's
        // `ZodIssue`s are available to classify below — the schema's object types still strip
        // unknown keys (zod's .strip()), so `sharedConfig` is the sanitised build and
        // `input.sharedConfig` may still carry caller-supplied extra keys.
        const parseResult = sharedAutogearBuildSchema.safeParse(input.sharedConfig);
        if (!parseResult.success) {
            if (parseResult.error.issues.some(isSharedBuildBasisCapIssue)) {
                console.error('Refusing to share a build that exceeds the basis caps');
                throw new SharedBuildExceedsBasisCapsError();
            }
            console.error('Refusing to share an invalid autogear build');
            throw new InvalidSharedConfigError();
        }
        const sharedConfig = parseResult.data as SharedAutogearBuild;

        if (!allowCritMultiplier && buildReferencesCritMultiplier(sharedConfig)) {
            console.error('Refusing to share a build using Crit Multiplier');
            throw new CritMultiplierShareNotAllowedError();
        }

        // `ship_role` mirrors the build's own role, or — in Custom mode — the role its
        // formula was seeded from. A hand-written formula with no `seededFrom` has neither,
        // so this is null — a legitimate value for the SharedAutogearBuild the client
        // computes, even though the database column itself is still NOT NULL (see
        // `RolelessShareNotAllowedError` below, and `ShipRoleColumnNotNullableError` above).
        const legacyShipRole = mirroredShipRole(sharedConfig);

        if (!allowRoleless && legacyShipRole === null) {
            throw new RolelessShareNotAllowedError();
        }

        const { data, error } = await supabase
            .from('community_recommendations')
            .insert({
                ship_name: input.shipName,
                ship_refit_level: input.shipRefitLevel,
                title: input.title,
                description: input.description,
                is_implant_specific: input.isImplantSpecific,
                ultimate_implant: input.ultimateImplant,
                // Dual write: shared_config is the source of truth, but the legacy columns
                // keep being populated so a bundle with no `shared_config` reader (pre-2026-08-29)
                // still reads a usable build from them. Derived from the same (sanitised)
                // object so they cannot drift.
                shared_config: JSON.parse(JSON.stringify(sharedConfig)),
                ship_role: legacyShipRole,
                stat_priorities: JSON.parse(JSON.stringify(sharedConfig.statPriorities)),
                stat_bonuses: JSON.parse(JSON.stringify(sharedConfig.statBonuses)),
                set_priorities: JSON.parse(JSON.stringify(sharedConfig.setPriorities)),
                // activeProfileId passed from call site — one recommendation per alt profile
                created_by: createdBy,
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating recommendation:', error);
            // 23502 is Postgres' not_null_violation. `ship_name` and `title` are also NOT
            // NULL on this table, so legacyShipRole === null alone does not identify which
            // column rejected the write — the error must also name `ship_role` (Postgres
            // reports the offending column in `message`/`details`) before this is reported
            // as the pending-migration case rather than an unrelated insert failure.
            if (
                legacyShipRole === null &&
                error.code === '23502' &&
                (error.message?.includes('ship_role') || error.details?.includes('ship_role'))
            ) {
                throw new ShipRoleColumnNotNullableError();
            }
            return null;
        }

        return data;
    }

    static async voteOnRecommendation(
        recommendationId: string,
        voteType: 'upvote' | 'downvote'
    ): Promise<boolean> {
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return false;
        }

        const { error } = await supabase.from('community_recommendation_votes').upsert(
            {
                recommendation_id: recommendationId,
                // Intentionally auth user (not activeProfileId): one vote per human —
                // alt profiles must not be able to inflate vote counts.
                user_id: user.id,
                vote_type: voteType,
            },
            {
                onConflict: 'recommendation_id,user_id',
            }
        );

        if (error) {
            console.error('Error voting on recommendation:', error);
            return false;
        }

        return true;
    }

    static async getUserVote(recommendationId: string): Promise<'upvote' | 'downvote' | null> {
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return null;
        }

        const { data, error } = await supabase
            .from('community_recommendation_votes')
            .select('vote_type')
            .eq('recommendation_id', recommendationId)
            // Intentionally auth user (not activeProfileId): votes are per-human.
            .eq('user_id', user.id)
            .single();

        if (error || !data) {
            return null;
        }

        return data.vote_type as 'upvote' | 'downvote';
    }

    static async removeVote(recommendationId: string): Promise<boolean> {
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return false;
        }

        const { error } = await supabase
            .from('community_recommendation_votes')
            .delete()
            .eq('recommendation_id', recommendationId)
            // Intentionally auth user (not activeProfileId): votes are per-human.
            .eq('user_id', user.id);

        if (error) {
            console.error('Error removing vote:', error);
            return false;
        }

        return true;
    }
}
