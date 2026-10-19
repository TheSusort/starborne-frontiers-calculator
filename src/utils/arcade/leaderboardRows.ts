export interface ArcadeLeaderboardEntry {
    rank: number;
    username: string;
    bestScore: number;
    isMe: boolean;
    /** The ship's template name for the best-score run; null for the neon fighter. */
    ship: string | null;
}

export interface ArcadeSubmitResult {
    bestScore: number;
    rank: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
/** The `arcade_scores.best_ship` bound; lengths count code points, as `char_length` does. */
export const SHIP_NAME_MAX = 64;

export const isValidShipName = (v: unknown): v is string =>
    typeof v === 'string' && v.length > 0 && [...v].length <= SHIP_NAME_MAX;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Validates `get_arcade_leaderboard` rows; a malformed row is dropped, never rendered. A
 * malformed ship only nulls the ship, so the row still shows.
 */
export function parseLeaderboardRows(data: unknown): ArcadeLeaderboardEntry[] {
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
        if (!isRecord(row)) return [];
        const { player_rank, username, best_score, is_me, best_ship } = row;
        if (!isInt(player_rank) || typeof username !== 'string' || !isInt(best_score)) return [];
        return [
            {
                rank: player_rank,
                username,
                bestScore: best_score,
                isMe: is_me === true,
                ship: isValidShipName(best_ship) ? best_ship : null,
            },
        ];
    });
}

/** Validates the single row `submit_arcade_score` returns. */
export function parseSubmitResult(data: unknown): ArcadeSubmitResult | null {
    const row = Array.isArray(data) ? data[0] : data;
    if (!isRecord(row)) return null;
    const { best, player_rank } = row;
    if (!isInt(best) || !isInt(player_rank)) return null;
    return { bestScore: best, rank: player_rank };
}
