import { supabase } from '../config/supabase';

export interface LeaderboardEntry {
    rank: number;
    totalPoints: number;
    isCurrentUser: boolean;
}

export interface TokensLeaderboardEntry {
    rank: number;
    totalTokens: number;
    isCurrentUser: boolean;
}

interface PointsRpcResponse {
    rank: number;
    total_points: number;
    is_current_user: boolean;
}

interface TokensRpcResponse {
    rank: number;
    total_tokens: number;
    is_current_user: boolean;
}

export async function getEngineeringLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_engineering_leaderboard', {
        current_user_id: userId,
    });

    if (error) {
        console.error('Error fetching engineering leaderboard:', error);
        throw error;
    }

    if (!data) {
        return [];
    }

    return (data as PointsRpcResponse[]).map((entry) => ({
        rank: entry.rank,
        totalPoints: entry.total_points,
        isCurrentUser: entry.is_current_user,
    }));
}

export async function getEngineeringTokensLeaderboard(
    userId: string
): Promise<TokensLeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_engineering_tokens_leaderboard', {
        current_user_id: userId,
    });

    if (error) {
        console.error('Error fetching engineering tokens leaderboard:', error);
        throw error;
    }

    if (!data) {
        return [];
    }

    return (data as TokensRpcResponse[]).map((entry) => ({
        rank: entry.rank,
        totalTokens: entry.total_tokens,
        isCurrentUser: entry.is_current_user,
    }));
}
