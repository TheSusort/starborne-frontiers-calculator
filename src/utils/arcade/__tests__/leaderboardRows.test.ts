import { describe, it, expect } from 'vitest';
import { parseLeaderboardRows, parseSubmitResult } from '../leaderboardRows';

describe('parseLeaderboardRows', () => {
    it('maps RPC rows', () => {
        expect(
            parseLeaderboardRows([
                { player_rank: 1, username: 'Ace', best_score: 900, is_me: false },
                { player_rank: 7, username: 'Me', best_score: 100, is_me: true },
            ])
        ).toEqual([
            { rank: 1, username: 'Ace', bestScore: 900, isMe: false },
            { rank: 7, username: 'Me', bestScore: 100, isMe: true },
        ]);
    });
    it('drops malformed rows and tolerates non-arrays', () => {
        expect(parseLeaderboardRows(null)).toEqual([]);
        expect(
            parseLeaderboardRows([
                { player_rank: '1', username: 'A', best_score: 1 },
                { player_rank: 1, username: null, best_score: 1 },
                { player_rank: 1, username: 'B', best_score: 1.5 },
                'junk',
            ])
        ).toEqual([]);
    });
    it('treats a missing is_me as false', () => {
        expect(
            parseLeaderboardRows([{ player_rank: 2, username: 'X', best_score: 5 }])[0].isMe
        ).toBe(false);
    });
});

describe('parseSubmitResult', () => {
    it('reads the first row of the RPC table', () => {
        expect(parseSubmitResult([{ best: 500, player_rank: 3 }])).toEqual({
            bestScore: 500,
            rank: 3,
        });
    });
    it('returns null for an empty or malformed result', () => {
        expect(parseSubmitResult([])).toBeNull();
        expect(parseSubmitResult([{ best: 'x', player_rank: 1 }])).toBeNull();
    });
});
