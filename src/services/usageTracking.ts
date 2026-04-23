import { supabase } from '../config/supabase';

const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000'; // Special UUID for anonymous users

/**
 * Increments the autogear run count for a user (logged in or anonymous)
 * Returns the new count after incrementing
 */
export async function trackAutogearRun(userId?: string | null): Promise<number | null> {
    try {
        const trackingUserId = userId || ANONYMOUS_USER_ID;
        const { error } = await supabase.rpc('increment_autogear_count', {
            user_id: trackingUserId,
        });

        if (error) {
            console.error('Error tracking autogear run:', error);
            return null;
        }

        // Fetch the updated count. For anonymous runs the sentinel user row
        // may not exist or may be hidden by RLS, so maybeSingle() returns
        // null instead of erroring on 0 rows.
        const { data, error: fetchError } = await supabase
            .from('users')
            .select('autogear_run_count')
            .eq('id', trackingUserId)
            .maybeSingle();

        if (fetchError) {
            console.error('Error fetching autogear count:', fetchError);
            return null;
        }

        return data?.autogear_run_count ?? null;
    } catch (error) {
        console.error('Error tracking autogear run:', error);
        return null;
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
