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
    return (data as TrafficSummary | null) ?? null;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Visitors per day over the selected range. The RPC returns no row for a day without traffic, so
 * those days count as zero; days before the first tracked day are not counted at all.
 */
export function averageDailyVisitors(
    daily: TrafficSummary['daily'],
    daysBack: number,
    today: Date
): number {
    if (daily.length === 0) return 0;
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const sinceFirst = Math.round((todayUtc - Date.parse(daily[0].day)) / DAY_MS) + 1;
    const days = Math.max(1, Math.min(daysBack, sinceFirst));
    return Math.round(daily.reduce((s, d) => s + d.visitors, 0) / days);
}
