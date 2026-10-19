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
            { rank: 1, username: 'Ace', bestScore: 900, isMe: false, ship: null },
            { rank: 7, username: 'Me', bestScore: 100, isMe: true, ship: null },
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

describe('parseLeaderboardRows ship', () => {
    const row = (best_ship: unknown) =>
        parseLeaderboardRows([{ player_rank: 1, username: 'Ace', best_score: 9, best_ship }])[0];

    it('reads a valid ship name', () => {
        expect(row('Nayra').ship).toBe('Nayra');
        expect(row('x'.repeat(64)).ship).toBe('x'.repeat(64));
    });
    it('treats a missing ship as null', () => {
        expect(
            parseLeaderboardRows([{ player_rank: 1, username: 'Ace', best_score: 9 }])[0].ship
        ).toBeNull();
        expect(row(null).ship).toBeNull();
    });
    it('keeps the row with a null ship when the ship is malformed', () => {
        for (const bad of [42, {}, ['Nayra'], true, '', 'x'.repeat(65)]) {
            expect(row(bad)).toEqual({
                rank: 1,
                username: 'Ace',
                bestScore: 9,
                isMe: false,
                ship: null,
            });
        }
    });
    it('counts characters as the database does, not UTF-16 units', () => {
        const astral = '\u{1F680}'.repeat(64);
        expect(row(astral).ship).toBe(astral);
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
