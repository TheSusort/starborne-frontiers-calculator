import { supabase } from '../config/supabase';
import {
    CommunityRecommendation,
    CreateCommunityRecommendationInput,
} from '../types/communityRecommendation';
import { validateSharedAutogearBuild } from '../schemas/sharedAutogearBuild';
import { mirroredShipRole } from '../utils/communityBuild';

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
 * Thrown by createRecommendation when the insert fails on a NOT NULL violation for
 * `ship_role` (Postgres code 23502) while writing a role-less build. `community_recommendations
 * .ship_role` is nullable from 20260923000001_nullable_community_recommendation_ship_role.sql
 * onward; this error means that migration has not been applied to the database this client is
 * talking to yet, so the write path's own null write is rejected at the DB rather than
 * silently dropped or crashing.
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
        createdBy: string
    ): Promise<CommunityRecommendation | null> {
        // Use the parsed result, not the raw input: object schemas strip unknown
        // keys (zod's .strip()), so `sharedConfig` is the sanitised build and
        // `input.sharedConfig` may still carry caller-supplied extra keys.
        const sharedConfig = validateSharedAutogearBuild(input.sharedConfig);
        if (!sharedConfig) {
            console.error('Refusing to share an invalid autogear build');
            throw new InvalidSharedConfigError();
        }

        // `ship_role` mirrors the build's own role, or — in Custom mode — the role its
        // formula was seeded from. A hand-written formula with no `seededFrom` has neither,
        // so this is null: a legitimate value for the nullable `ship_role` column.
        const legacyShipRole = mirroredShipRole(sharedConfig);

        const { data, error } = await supabase
            .from('community_recommendations')
            .insert({
                ship_name: input.shipName,
                ship_refit_level: input.shipRefitLevel,
                title: input.title,
                description: input.description,
                is_implant_specific: input.isImplantSpecific,
                ultimate_implant: input.ultimateImplant,
                // Dual write: shared_config is the source of truth, but the legacy
                // columns keep being populated so a stale cached bundle still reads
                // a usable build. Derived from the same (sanitised) object so they
                // cannot drift.
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
            // 23502 is Postgres' not_null_violation. legacyShipRole is only ever null when
            // this insert deliberately wrote NULL, so that combination identifies the
            // pending-migration case rather than a generic insert failure.
            if (legacyShipRole === null && error.code === '23502') {
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
