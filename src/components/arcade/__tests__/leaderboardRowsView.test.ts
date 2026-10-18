import { describe, it, expect } from 'vitest';
import { withGapRows } from '../leaderboardRowsView';
import type { ArcadeLeaderboardEntry } from '../../../utils/arcade/leaderboardRows';

const row = (rank: number, isMe = false): ArcadeLeaderboardEntry => ({
    rank,
    username: `p${rank}`,
    bestScore: 1000 - rank,
    isMe,
});

describe('withGapRows', () => {
    it('adds no gap when the own row follows directly', () => {
        const rows = [row(1), row(2), row(3, true)];
        expect(withGapRows(rows)).toEqual(rows);
    });

    it('inserts a gap when the rank jumps to the own row', () => {
        const rows = [row(11), row(12), row(37, true)];
        expect(withGapRows(rows)).toEqual([rows[0], rows[1], { kind: 'gap' }, rows[2]]);
    });

    it('adds no gap for ties', () => {
        const rows = [row(5), row(5, true)];
        expect(withGapRows(rows)).toEqual(rows);
    });

    it('leaves rows unchanged without an own row', () => {
        const rows = [row(1), row(2), row(40)];
        expect(withGapRows(rows)).toEqual(rows);
    });
});
