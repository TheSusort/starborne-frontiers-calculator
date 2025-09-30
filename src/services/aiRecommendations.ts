import { supabase } from '../config/supabase';

export interface AIRecommendation {
    id?: string;
    ship_name: string;
    ship_refit_level: number;
    ship_implants: Record<string, string>;
    ship_role: string;
    stat_priorities: Array<{
        stat: string;
        minLimit?: number;
        maxLimit?: number;
        reasoning?: string;
    }>;
    stat_bonuses: Array<{
        stat: string;
        weight: number;
        reasoning?: string;
    }>;
    set_priorities: Array<{
        setName: string;
    }>;
    reasoning: string;
    upvotes?: number;
    downvotes?: number;
    total_votes?: number;
    score?: number;
    created_by?: string;
    created_at?: string;
    updated_at?: string;
}

export interface UserVote {
    recommendation_id: string;
    vote_type: 'upvote' | 'downvote';
}

export class AIRecommendationService {
    /**
     * Get the best community recommendation for a ship
     */
    static async getBestRecommendation(
        shipName: string,
        refitLevel: number = 0,
        implants: Record<string, string> = {}
    ): Promise<AIRecommendation | null> {
        try {
            // For RPC calls, Supabase handles JSON serialization automatically
            // but we still need to ensure clean objects
            const cleanImplants = implants || {};

            const { data, error } = await supabase.rpc('get_best_recommendation', {
                p_ship_name: shipName,
                p_refit_level: refitLevel,
                p_implants: cleanImplants,
            });

            if (error) {
                console.error('Error fetching best recommendation:', error);
                return null;
            }

            return data?.[0] || null;
        } catch (error) {
            console.error('Error in getBestRecommendation:', error);
            return null;
        }
    }

    /**
     * Save a new AI recommendation
     */
    static async saveRecommendation(
        recommendation: Omit<
            AIRecommendation,
            | 'id'
            | 'upvotes'
            | 'downvotes'
            | 'total_votes'
            | 'score'
            | 'created_by'
            | 'created_at'
            | 'updated_at'
        >
    ): Promise<AIRecommendation | null> {
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            // Ensure all JSON fields are properly serialized
            const cleanedRecommendation = {
                ...recommendation,
                ship_implants: JSON.parse(JSON.stringify(recommendation.ship_implants || {})),
                stat_priorities: JSON.parse(JSON.stringify(recommendation.stat_priorities || [])),
                stat_bonuses: JSON.parse(JSON.stringify(recommendation.stat_bonuses || [])),
                set_priorities: JSON.parse(JSON.stringify(recommendation.set_priorities || [])),
                created_by: user?.id,
            };

            const { data, error } = await supabase
                .from('ai_recommendations')
                .insert(cleanedRecommendation)
                .select()
                .single();

            if (error) {
                console.error('Error saving recommendation:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error in saveRecommendation:', error);
            return null;
        }
    }

    /**
     * Get alternative recommendations (excluding the best one)
     */
    static async getAlternativeRecommendations(
        shipName: string,
        refitLevel: number = 0,
        implants: Record<string, string> = {},
        excludeId?: string
    ): Promise<AIRecommendation[]> {
        try {
            // For RPC calls, Supabase handles JSON serialization automatically
            const cleanImplants = implants || {};

            let query = supabase
                .from('ai_recommendations')
                .select('*')
                .eq('ship_name', shipName)
                .eq('ship_refit_level', refitLevel)
                .order('score', { ascending: false })
                .order('total_votes', { ascending: false })
                .order('created_at', { ascending: false });

            // Exclude the best recommendation if provided
            if (excludeId) {
                query = query.neq('id', excludeId);
            }

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching alternative recommendations:', error);
                return [];
            }

            // Filter by implants in JavaScript and return alternatives
            const implantsString = JSON.stringify(cleanImplants);
            const alternatives = (data || []).filter((rec) => {
                const recImplantsString = JSON.stringify(rec.ship_implants || {});
                return (
                    recImplantsString === implantsString ||
                    JSON.stringify(rec.ship_implants || {}) === '{}'
                ); // Include no-implant alternatives
            });

            return alternatives;
        } catch (error) {
            console.error('Error in getAlternativeRecommendations:', error);
            return [];
        }
    }

    /**
     * Get all recommendations for a ship (for debugging/admin purposes)
     */
    static async getAllRecommendations(shipName: string): Promise<AIRecommendation[]> {
        try {
            const { data, error } = await supabase
                .from('ai_recommendations')
                .select('*')
                .eq('ship_name', shipName)
                .order('score', { ascending: false })
                .order('total_votes', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching recommendations:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('Error in getAllRecommendations:', error);
            return [];
        }
    }

    /**
     * Vote on a recommendation
     */
    static async voteOnRecommendation(
        recommendationId: string,
        voteType: 'upvote' | 'downvote'
    ): Promise<boolean> {
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
                // eslint-disable-next-line no-console
                console.warn('User must be logged in to vote');
                return false;
            }

            const { error } = await supabase
                .from('ai_recommendation_votes')
                .upsert({
                    recommendation_id: recommendationId,
                    user_id: user.id,
                    vote_type: voteType,
                })
                .select();

            if (error) {
                console.error('Error voting on recommendation:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in voteOnRecommendation:', error);
            return false;
        }
    }

    /**
     * Get user's vote on a recommendation
     */
    static async getUserVote(recommendationId: string): Promise<'upvote' | 'downvote' | null> {
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
                return null;
            }

            const { data, error } = await supabase
                .from('ai_recommendation_votes')
                .select('vote_type')
                .eq('recommendation_id', recommendationId)
                .eq('user_id', user.id)
                .single();

            if (error) {
                // No vote found is not an error
                return null;
            }

            return data?.vote_type || null;
        } catch (error) {
            console.error('Error in getUserVote:', error);
            return null;
        }
    }

    /**
     * Remove user's vote on a recommendation
     */
    static async removeVote(recommendationId: string): Promise<boolean> {
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
                return false;
            }

            const { error } = await supabase
                .from('ai_recommendation_votes')
                .delete()
                .eq('recommendation_id', recommendationId)
                .eq('user_id', user.id);

            if (error) {
                console.error('Error removing vote:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in removeVote:', error);
            return false;
        }
    }

    /**
     * Check if a similar recommendation already exists
     */
    static async findSimilarRecommendation(
        shipName: string,
        refitLevel: number,
        implants: Record<string, string>,
        shipRole: string
    ): Promise<AIRecommendation | null> {
        try {
            // Get all recommendations for this ship/refit/role and filter by implants in JavaScript
            // This avoids the JSON comparison issues in PostgreSQL
            const { data, error } = await supabase
                .from('ai_recommendations')
                .select('*')
                .eq('ship_name', shipName)
                .eq('ship_refit_level', refitLevel)
                .eq('ship_role', shipRole)
                .order('score', { ascending: false });

            if (error) {
                console.error('Error finding similar recommendation:', error);
                return null;
            }

            // Filter by implants in JavaScript for exact match
            const implantsString = JSON.stringify(implants || {});
            const matching = data?.find((rec) => {
                const recImplantsString = JSON.stringify(rec.ship_implants || {});
                return recImplantsString === implantsString;
            });

            return matching || null;
        } catch (error) {
            console.error('Error in findSimilarRecommendation:', error);
            return null;
        }
    }
}
