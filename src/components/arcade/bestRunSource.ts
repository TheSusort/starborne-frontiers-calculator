import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';
import type { LocalBestRun } from './localBest';

export interface BestRun {
    score: number;
    distance: number | null;
    credits: number | null;
    /** Null when the run comes from this browser and the leaderboard has no row for the viewer. */
    rank: number | null;
}

/** The viewer's best run: their leaderboard row when present, else this browser's best, else none. */
export function pickBestRun(
    rows: readonly ArcadeLeaderboardEntry[],
    local: LocalBestRun | null
): BestRun | null {
    const mine = rows.find((r) => r.isMe);
    if (mine) {
        return {
            score: mine.bestScore,
            distance: mine.distance,
            credits: mine.credits,
            rank: mine.rank,
        };
    }
    if (local && local.score > 0) {
        return { score: local.score, distance: local.distance, credits: local.credits, rank: null };
    }
    return null;
}
