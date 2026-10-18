import { supabase } from '../config/supabase';
import type { RunResult } from '../utils/arcade/types';
import {
    ArcadeLeaderboardEntry,
    ArcadeSubmitResult,
    parseLeaderboardRows,
    parseSubmitResult,
} from '../utils/arcade/leaderboardRows';

export async function submitArcadeScore(run: RunResult): Promise<ArcadeSubmitResult | null> {
    const { data, error } = await supabase.rpc('submit_arcade_score', {
        p_score: run.score,
        p_credits: run.credits,
        p_distance: run.distance,
    });
    if (error) throw error;
    return parseSubmitResult(data);
}

export async function getArcadeLeaderboard(limit = 20): Promise<ArcadeLeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_arcade_leaderboard', { p_limit: limit });
    if (error) throw error;
    return parseLeaderboardRows(data);
}
