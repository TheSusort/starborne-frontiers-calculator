import { supabase } from '../config/supabase';
import {
    CommunityRecommendation,
    CreateCommunityRecommendationInput,
} from '../types/communityRecommendation';

export class CommunityRecommendationService {
    static async getBestRecommendation(
        shipName: string,
        ultimateImplant?: string
    ): Promise<CommunityRecommendation | null> {
        const { data, error } = await supabase.rpc('get_best_community_recommendation', {
            p_ship_name: shipName,
            p_ultimate_implant: ultimateImplant ?? null,
        });

        if (error) {
            console.error('Error fetching best recommendation:', error);
            return null;
        }

        return data && data.length > 0 ? data[0] : null;
    }

    static async getAlternatives(
        shipName: string,
        ultimateImplant?: string,
        excludeId?: string
    ): Promise<CommunityRecommendation[]> {
        let query = supabase
            .from('community_recommendations')
            .select('*')
            .eq('ship_name', shipName)
            .order('score', { ascending: false })
            .order('total_votes', { ascending: false })
            .order('created_at', { ascending: false });

        if (excludeId) {
            query = query.neq('id', excludeId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching alternatives:', error);
            return [];
        }

        // Filter in JavaScript: include if not implant-specific OR ultimate_implant matches
        return (data || []).filter(
            (rec) => !rec.is_implant_specific || rec.ultimate_implant === ultimateImplant
        );
    }

    static async createRecommendation(
        input: CreateCommunityRecommendationInput
    ): Promise<CommunityRecommendation | null> {
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return null;
        }

        const { data, error } = await supabase
            .from('community_recommendations')
            .insert({
                ship_name: input.shipName,
                ship_refit_level: 0,
                title: input.title,
                description: input.description,
                is_implant_specific: input.isImplantSpecific,
                ultimate_implant: input.ultimateImplant,
                ship_role: input.shipRole,
                stat_priorities: JSON.parse(JSON.stringify(input.statPriorities)),
                stat_bonuses: JSON.parse(JSON.stringify(input.statBonuses)),
                set_priorities: JSON.parse(JSON.stringify(input.setPriorities)),
                created_by: user.id,
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
            .eq('user_id', user.id);

        if (error) {
            console.error('Error removing vote:', error);
            return false;
        }

        return true;
    }
}
