import { supabase } from '../config/supabase';
import {
    StatisticsSnapshot,
    SnapshotListItem,
    ShipsSnapshot,
    GearSnapshot,
    ImplantsSnapshot,
    EngineeringSnapshot,
} from '../types/statisticsSnapshot';

interface SnapshotData {
    shipsStats: ShipsSnapshot | null;
    gearStats: GearSnapshot | null;
    implantsStats: ImplantsSnapshot | null;
    engineeringStats: EngineeringSnapshot | null;
}

export async function getSnapshotList(userId: string): Promise<SnapshotListItem[]> {
    const { data, error } = await supabase
        .from('statistics_snapshots')
        .select('id, snapshot_month')
        .eq('user_id', userId)
        .order('snapshot_month', { ascending: false });

    if (error) {
        console.error('Failed to fetch snapshot list:', error);
        return [];
    }

    return (data || []).map((row) => ({
        id: row.id,
        snapshotMonth: row.snapshot_month,
    }));
}

export async function getSnapshot(
    userId: string,
    month: string
): Promise<StatisticsSnapshot | null> {
    const { data, error } = await supabase
        .from('statistics_snapshots')
        .select('*')
        .eq('user_id', userId)
        .eq('snapshot_month', month)
        .maybeSingle();

    if (error) {
        console.error('Failed to fetch snapshot:', error);
        return null;
    }

    if (!data) return null;

    return {
        id: data.id,
        userId: data.user_id,
        snapshotMonth: data.snapshot_month,
        shipsStats: data.ships_stats,
        gearStats: data.gear_stats,
        implantsStats: data.implants_stats,
        engineeringStats: data.engineering_stats,
        createdAt: data.created_at,
    };
}

export async function createSnapshot(
    userId: string,
    month: string,
    snapshotData: SnapshotData
): Promise<void> {
    const { error } = await supabase.from('statistics_snapshots').upsert(
        {
            user_id: userId,
            snapshot_month: month,
            ships_stats: snapshotData.shipsStats,
            gear_stats: snapshotData.gearStats,
            implants_stats: snapshotData.implantsStats,
            engineering_stats: snapshotData.engineeringStats,
        },
        { onConflict: 'user_id,snapshot_month', ignoreDuplicates: true }
    );

    if (error) {
        console.error('Failed to create snapshot:', error);
    }
}
