import { supabase } from '../config/supabase';

export interface LeaderboardEntry {
    rank: number;
    totalPoints: number;
    isCurrentUser: boolean;
}

interface RpcResponse {
    rank: number;
    total_points: number;
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

    return (data as RpcResponse[]).map((entry) => ({
        rank: entry.rank,
        totalPoints: entry.total_points,
        isCurrentUser: entry.is_current_user,
    }));
}
