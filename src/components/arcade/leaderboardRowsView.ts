import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';

export interface GapRow {
    kind: 'gap';
}

export type LeaderboardViewRow = ArcadeLeaderboardEntry | GapRow;

export const isGapRow = (row: LeaderboardViewRow): row is GapRow => (row as GapRow).kind === 'gap';

export const PODIUM_SIZE = 3;

/**
 * Splits rank-ordered entries into the podium (the first three entries, whatever their rank —
 * ties share a rank number, so two podium places can both show #1) and the rest.
 */
export function splitPodium(entries: ArcadeLeaderboardEntry[]): {
    podium: ArcadeLeaderboardEntry[];
    rest: ArcadeLeaderboardEntry[];
} {
    return { podium: entries.slice(0, PODIUM_SIZE), rest: entries.slice(PODIUM_SIZE) };
}

/**
 * Inserts a gap sentinel before the player's own row when its rank is not directly
 * after the previous row's rank. Ties share a rank and are never a gap. `previousRank` is the
 * rank of the row shown just before `entries` (the last podium place), so an own row that
 * opens the list is compared against it.
 */
export function withGapRows(
    entries: ArcadeLeaderboardEntry[],
    previousRank?: number
): LeaderboardViewRow[] {
    const out: LeaderboardViewRow[] = [];
    entries.forEach((entry, i) => {
        const prior = i > 0 ? entries[i - 1].rank : previousRank;
        if (entry.isMe && prior !== undefined && entry.rank - prior > 1) {
            out.push({ kind: 'gap' });
        }
        out.push(entry);
    });
    return out;
}
