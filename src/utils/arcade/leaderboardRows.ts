export interface ArcadeLeaderboardEntry {
    rank: number;
    username: string;
    bestScore: number;
    isMe: boolean;
}

export interface ArcadeSubmitResult {
    bestScore: number;
    rank: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validates `get_arcade_leaderboard` rows; a malformed row is dropped, never rendered. */
export function parseLeaderboardRows(data: unknown): ArcadeLeaderboardEntry[] {
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
        if (!isRecord(row)) return [];
        const { player_rank, username, best_score, is_me } = row;
        if (!isInt(player_rank) || typeof username !== 'string' || !isInt(best_score)) return [];
        return [{ rank: player_rank, username, bestScore: best_score, isMe: is_me === true }];
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
