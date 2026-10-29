import { describe, it, expect } from 'vitest';
import { splitPodium, withGapRows } from '../leaderboardRowsView';
import type { ArcadeLeaderboardEntry } from '../../../utils/arcade/leaderboardRows';

const row = (rank: number, isMe = false): ArcadeLeaderboardEntry => ({
    rank,
    username: `p${rank}`,
    bestScore: 1000 - rank,
    isMe,
    ship: null,
    isGuest: false,
    distance: null,
    credits: null,
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

describe('splitPodium', () => {
    it('puts every entry on the podium when there are fewer than three', () => {
        const rows = [row(1), row(2)];
        expect(splitPodium(rows)).toEqual({ podium: rows, rest: [] });
    });

    it('returns an empty podium and rest for no entries', () => {
        expect(splitPodium([])).toEqual({ podium: [], rest: [] });
    });

    it('keeps tied ranks on the podium with their shared rank', () => {
        const rows = [row(1), row(1), row(3), row(4)];
        const { podium, rest } = splitPodium(rows);
        expect(podium.map((r) => r.rank)).toEqual([1, 1, 3]);
        expect(rest).toEqual([rows[3]]);
    });

    it('keeps the own row on the podium when it places in the top three', () => {
        const rows = [row(1), row(2, true), row(3), row(4)];
        const { podium, rest } = splitPodium(rows);
        expect(podium[1].isMe).toBe(true);
        expect(rest.some((r) => r.isMe)).toBe(false);
    });
});

describe('withGapRows after the podium', () => {
    it('inserts a gap before an own row appended right after the podium', () => {
        const rows = [row(1), row(2), row(3), row(37, true)];
        const { podium, rest } = splitPodium(rows);
        expect(withGapRows(rest, podium[podium.length - 1].rank)).toEqual([
            { kind: 'gap' },
            rows[3],
        ]);
    });

    it('inserts a gap before an own row appended after table rows', () => {
        const rows = [row(1), row(2), row(3), row(4), row(5), row(37, true)];
        const { podium, rest } = splitPodium(rows);
        expect(withGapRows(rest, podium[podium.length - 1].rank)).toEqual([
            rows[3],
            rows[4],
            { kind: 'gap' },
            rows[5],
        ]);
    });

    it('adds no gap when the own row directly follows the podium', () => {
        const rows = [row(1), row(2), row(3), row(4, true)];
        const { podium, rest } = splitPodium(rows);
        expect(withGapRows(rest, podium[podium.length - 1].rank)).toEqual([rows[3]]);
    });
});
