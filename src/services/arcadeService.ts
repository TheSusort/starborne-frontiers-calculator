import { supabase } from '../config/supabase';
import type { RunResult } from '../utils/arcade/types';
import {
    ArcadeLeaderboardEntry,
    ArcadeSubmitResult,
    isValidShipName,
    parseLeaderboardRows,
    parseSubmitResult,
} from '../utils/arcade/leaderboardRows';

/** Another guest already holds the name (case-insensitive). Nothing was saved. */
export class GuestNameTakenError extends Error {}
/** The guest has no name yet; the score needs one before it can be saved. */
export class GuestNameRequiredError extends Error {}

/**
 * Submits a finished run. `shipName` is the flown fleet ship's template name; it is sent only
 * when it fits the `best_ship` bound, so a neon-fighter run (or an unstorable name) still saves
 * its score with no ship. `guestName` claims or renames the anonymous caller's guest name in
 * the same call.
 */
export async function submitArcadeScore(
    run: RunResult,
    shipName?: string | null,
    guestName?: string | null
): Promise<ArcadeSubmitResult | null> {
    const base = {
        p_score: run.score,
        p_credits: run.credits,
        p_distance: run.distance,
        ...(guestName ? { p_guest_name: guestName } : {}),
    };
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
    // 23505 is a unique violation; with a guest name sent, it is the guest-name index.
    if (error?.code === '23505' && guestName) throw new GuestNameTakenError(error.message);
    if (error?.message === 'guest_name_required') throw new GuestNameRequiredError(error.message);
    if (error) throw error;
    return parseSubmitResult(data);
}

/** The signed-in guest's own name, read through the own-row SELECT policy; null if unset. */
export async function getOwnGuestName(userId: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('arcade_guest_names')
        .select('name')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    return typeof data?.name === 'string' ? data.name : null;
}

export async function getArcadeLeaderboard(limit = 20): Promise<ArcadeLeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_arcade_leaderboard', { p_limit: limit });
    if (error) throw error;
    return parseLeaderboardRows(data);
}
