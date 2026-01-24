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

export interface LiveTraffic {
    active_sessions: number;
    authenticated_users: number;
    anonymous_sessions: number;
    top_pages: { path: string; count: number }[];
}

export type UserSortField =
    | 'email'
    | 'total_autogear_runs'
    | 'total_data_imports'
    | 'total_activity'
    | 'last_active';
export type SortDirection = 'asc' | 'desc';

export interface AllUsersParams {
    search?: string;
    sortBy?: UserSortField;
    sortDirection?: SortDirection;
    limit?: number;
    offset?: number;
}

export interface AllUsersResponse {
    users: TopUser[];
    totalCount: number;
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

/**
 * Get live traffic stats (users active in last 60 seconds)
 */
export async function getLiveTraffic(): Promise<LiveTraffic | null> {
    try {
        const { data, error } = await supabase.rpc('get_live_traffic');

        if (error) {
            console.error('Error fetching live traffic:', error);
            return null;
        }

        // RPC returns an array with one row
        if (data && data.length > 0) {
            return data[0];
        }

        return {
            active_sessions: 0,
            authenticated_users: 0,
            anonymous_sessions: 0,
            top_pages: [],
        };
    } catch (error) {
        console.error('Error fetching live traffic:', error);
        return null;
    }
}

/**
 * Get all users with sorting, searching, and pagination
 */
export async function getAllUsers(params: AllUsersParams = {}): Promise<AllUsersResponse> {
    try {
        const {
            search = '',
            sortBy = 'total_activity',
            sortDirection = 'desc',
            limit = 50,
            offset = 0,
        } = params;

        // Use the same RPC function as getTopActiveUsers but with a high limit to get all users
        const { data: allUsersData, error: rpcError } = await supabase.rpc('get_top_active_users', {
            limit_count: 10000, // High limit to get all users
        });

        if (rpcError) {
            console.error('Error fetching users via RPC:', rpcError);
            return { users: [], totalCount: 0 };
        }

        if (!allUsersData || allUsersData.length === 0) {
            return { users: [], totalCount: 0 };
        }

        // Convert to TopUser format (the RPC should already return this format)
        let result: TopUser[] = allUsersData;

        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            result = result.filter((user) => user.email.toLowerCase().includes(searchLower));
        }

        // Sort the results
        result.sort((a, b) => {
            let aVal: string | number = a[sortBy];
            let bVal: string | number = b[sortBy];

            // Handle null/undefined values
            if (!aVal) aVal = sortBy === 'email' ? '' : 0;
            if (!bVal) bVal = sortBy === 'email' ? '' : 0;

            if (sortDirection === 'asc') {
                return aVal > bVal ? 1 : -1;
            } else {
                return aVal < bVal ? 1 : -1;
            }
        });

        // Get the total count after filtering
        const totalCount = result.length;

        // Apply pagination
        const paginatedResult = result.slice(offset, offset + limit);

        return {
            users: paginatedResult,
            totalCount: totalCount,
        };
    } catch (error) {
        console.error('Error fetching all users:', error);
        return { users: [], totalCount: 0 };
    }
}
