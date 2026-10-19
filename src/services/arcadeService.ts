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
    const base = { p_score: run.score, p_credits: run.credits, p_distance: run.distance };
    const withShip = isValidShipName(shipName);
    let { data, error } = await supabase.rpc(
        'submit_arcade_score',
        withShip ? { ...base, p_ship: shipName } : base
    );
    // PGRST202: no function matches the sent argument names, i.e. the database has not
    // gained `p_ship` yet. The score still saves, without its ship.
    if (error?.code === 'PGRST202' && withShip) {
        ({ data, error } = await supabase.rpc('submit_arcade_score', base));
    }
    if (error) throw error;
    return parseSubmitResult(data);
}

export async function getArcadeLeaderboard(limit = 20): Promise<ArcadeLeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_arcade_leaderboard', { p_limit: limit });
    if (error) throw error;
    return parseLeaderboardRows(data);
}
