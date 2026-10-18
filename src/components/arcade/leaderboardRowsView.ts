import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';

export interface GapRow {
    kind: 'gap';
}

export type LeaderboardViewRow = ArcadeLeaderboardEntry | GapRow;

export const isGapRow = (row: LeaderboardViewRow): row is GapRow => (row as GapRow).kind === 'gap';

/**
 * Inserts a gap sentinel before the player's own row when its rank is not directly
 * after the previous row's rank. Ties share a rank and are never a gap.
 */
export function withGapRows(entries: ArcadeLeaderboardEntry[]): LeaderboardViewRow[] {
    const out: LeaderboardViewRow[] = [];
    entries.forEach((entry, i) => {
        if (i > 0 && entry.isMe && entry.rank - entries[i - 1].rank > 1) {
            out.push({ kind: 'gap' });
        }
        out.push(entry);
    });
    return out;
}
