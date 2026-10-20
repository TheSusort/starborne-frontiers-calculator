import { supabase } from '../config/supabase';

export interface TrafficSummary {
    daily: { day: string; views: number; visitors: number; sessions: number }[];
    pages: { path: string; views: number; entries: number; exits: number; avg_active_ms: number }[];
    referrers: { referrer_host: string; entries: number }[];
    devices: { mobile: number; tablet: number; desktop: number };
    clicks: { path: string; track_id: string; clicks: number }[];
    errors: {
        fingerprint: string;
        app_version: string;
        count: number;
        visitors: number;
        last_seen: string;
        sample_message: string;
        sample_stack: string;
        sample_path: string;
    }[];
}

export async function getTrafficSummary(days: number): Promise<TrafficSummary | null> {
    const { data, error } = await supabase.rpc('get_traffic_summary', { p_days: days });
    if (error) {
        console.error('Error loading traffic summary:', error);
        return null;
    }
    return data as TrafficSummary;
}

export function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
}
