import { supabase } from '../config/supabase';

export interface SystemStats {
    total_ships: number;
    total_inventory: number;
    total_loadouts: number;
    total_encounters: number;
    total_users: number;
    total_active_users: number;
    avg_ships_per_user: number;
    avg_gear_per_user: number;
}

export interface GrowthMetric {
    date: string;
    new_ships: number;
    new_gear: number;
    new_loadouts: number;
    new_users: number;
}

export interface TableInfo {
    table_name: string;
    row_count: number;
    total_size: string;
    table_size: string;
    indexes_size: string;
}

export interface UserDistribution {
    activity_level: string;
    user_count: number;
    percentage: number;
}

export interface SystemSnapshot {
    snapshot_date: string;
    total_ships: number;
    total_inventory: number;
    total_loadouts: number;
    total_encounters: number;
    total_users: number;
    total_active_users: number;
    avg_ships_per_user: number;
    avg_gear_per_user: number;
}

/**
 * Get current system statistics
 */
export async function getSystemStats(): Promise<SystemStats | null> {
    try {
        const { data, error } = await supabase.rpc('get_system_stats');

        if (error) {
            console.error('Error fetching system stats:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching system stats:', error);
        return null;
    }
}

/**
 * Get growth metrics for the specified number of days
 */
export async function getGrowthStats(daysBack: number = 30): Promise<GrowthMetric[] | null> {
    try {
        const { data, error } = await supabase.rpc('get_growth_stats', {
            days_back: daysBack,
        });

        if (error) {
            console.error('Error fetching growth stats:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching growth stats:', error);
        return null;
    }
}

/**
 * Get table sizes and row counts
 */
export async function getTableSizes(): Promise<TableInfo[] | null> {
    try {
        const { data, error } = await supabase.rpc('get_table_sizes');

        if (error) {
            console.error('Error fetching table sizes:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching table sizes:', error);
        return null;
    }
}

/**
 * Get user distribution by activity level
 */
export async function getUserDistribution(): Promise<UserDistribution[] | null> {
    try {
        const { data, error } = await supabase.rpc('get_user_distribution');

        if (error) {
            console.error('Error fetching user distribution:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching user distribution:', error);
        return null;
    }
}

/**
 * Create a system snapshot for today
 */
export async function createSystemSnapshot(): Promise<boolean> {
    try {
        const { error } = await supabase.rpc('create_system_snapshot');

        if (error) {
            console.error('Error creating system snapshot:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error creating system snapshot:', error);
        return false;
    }
}

/**
 * Get historical system snapshots
 */
export async function getSystemSnapshots(daysBack: number = 30): Promise<SystemSnapshot[] | null> {
    try {
        const { data, error } = await supabase.rpc('get_system_snapshots', {
            days_back: daysBack,
        });

        if (error) {
            console.error('Error fetching system snapshots:', error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching system snapshots:', error);
        return null;
    }
}
