import { supabase } from '../config/supabase';
import {
    CommunityRecommendation,
    CreateCommunityRecommendationInput,
} from '../types/communityRecommendation';
import { validateSharedAutogearBuild } from '../schemas/sharedAutogearBuild';

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
                ship_role: sharedConfig.shipRole,
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
