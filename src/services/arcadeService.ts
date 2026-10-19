import { supabase } from '../config/supabase';
import type { RunResult } from '../utils/arcade/types';
import {
    ArcadeLeaderboardEntry,
    ArcadeSubmitResult,
    isValidShipName,
    parseLeaderboardRows,
    parseSubmitResult,
} from '../utils/arcade/leaderboardRows';

/**
 * Submits a finished run. `shipName` is the flown fleet ship's template name; it is sent only
 * when it fits the `best_ship` bound, so a neon-fighter run (or an unstorable name) still saves
 * its score with no ship.
 */
export async function submitArcadeScore(
    run: RunResult,
    shipName?: string | null
): Promise<ArcadeSubmitResult | null> {
    const { data, error } = await supabase.rpc('submit_arcade_score', {
        p_score: run.score,
        p_credits: run.credits,
        p_distance: run.distance,
        ...(isValidShipName(shipName) ? { p_ship: shipName } : {}),
    });
    if (error) throw error;
    return parseSubmitResult(data);
}

export async function getArcadeLeaderboard(limit = 20): Promise<ArcadeLeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_arcade_leaderboard', { p_limit: limit });
    if (error) throw error;
    return parseLeaderboardRows(data);
}
