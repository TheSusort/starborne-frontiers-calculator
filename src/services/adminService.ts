import { supabase } from '../config/supabase';

export interface DailyUsageStat {
    date: string;
    total_autogear_runs: number;
    total_data_imports: number;
    unique_active_users: number;
}

export interface TopUser {
    user_id: string;
    email: string;
    total_autogear_runs: number;
    total_data_imports: number;
    total_activity: number;
    last_active: string;
}

/**
 * Check if the current user is an admin
 */
export async function isAdmin(userId: string): Promise<boolean> {
    try {
        const { data, error } = await supabase.rpc('is_user_admin', { p_user_id: userId });

        if (error) {
            console.error('Error checking admin status:', error);
            return false;
        }

        return data || false;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return false;
    }
}

/**
 * Get daily usage statistics for the specified number of days
 */
export async function getDailyUsageStats(daysBack: number = 30): Promise<DailyUsageStat[] | null> {
    try {
        const { data, error } = await supabase.rpc('get_daily_usage_stats', {
            days_back: daysBack,
        });

        if (error) {
            console.error('Error fetching daily usage stats:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching daily usage stats:', error);
        return null;
    }
}

/**
 * Get top active users
 */
export async function getTopActiveUsers(limit: number = 5): Promise<TopUser[] | null> {
    try {
        const { data, error } = await supabase.rpc('get_top_active_users', {
            limit_count: limit,
        });

        if (error) {
            console.error('Error fetching top active users:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching top active users:', error);
        return null;
    }
}

/**
 * Get total user count
 */
export async function getTotalUserCount(): Promise<number> {
    try {
        const { count, error } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error('Error fetching user count:', error);
            return 0;
        }

        return count || 0;
    } catch (error) {
        console.error('Error fetching user count:', error);
        return 0;
    }
}
