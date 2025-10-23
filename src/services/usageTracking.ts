import { supabase } from '../config/supabase';

const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000'; // Special UUID for anonymous users

/**
 * Increments the autogear run count for a user (logged in or anonymous)
 */
export async function trackAutogearRun(userId?: string | null): Promise<void> {
    try {
        const trackingUserId = userId || ANONYMOUS_USER_ID;
        const { error } = await supabase.rpc('increment_autogear_count', {
            user_id: trackingUserId,
        });

        if (error) {
            console.error('Error tracking autogear run:', error);
        }
    } catch (error) {
        console.error('Error tracking autogear run:', error);
    }
}

/**
 * Increments the data import count for a user (logged in or anonymous)
 */
export async function trackDataImport(userId?: string | null): Promise<void> {
    try {
        const trackingUserId = userId || ANONYMOUS_USER_ID;
        const { error } = await supabase.rpc('increment_import_count', {
            user_id: trackingUserId,
        });

        if (error) {
            console.error('Error tracking data import:', error);
        }
    } catch (error) {
        console.error('Error tracking data import:', error);
    }
}

/**
 * Gets usage stats for a user
 */
export async function getUserUsageStats(userId: string): Promise<{
    autogearRunCount: number;
    dataImportCount: number;
} | null> {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('autogear_run_count, data_import_count')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Error getting usage stats:', error);
            return null;
        }

        return {
            autogearRunCount: data?.autogear_run_count || 0,
            dataImportCount: data?.data_import_count || 0,
        };
    } catch (error) {
        console.error('Error getting usage stats:', error);
        return null;
    }
}
