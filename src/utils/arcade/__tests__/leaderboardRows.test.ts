import { describe, it, expect } from 'vitest';
import { isValidGuestName, parseLeaderboardRows, parseSubmitResult } from '../leaderboardRows';

describe('parseLeaderboardRows', () => {
    it('maps RPC rows', () => {
        expect(
            parseLeaderboardRows([
                { player_rank: 1, username: 'Ace', best_score: 900, is_me: false },
                { player_rank: 7, username: 'Me', best_score: 100, is_me: true },
            ])
        ).toEqual([
            { rank: 1, username: 'Ace', bestScore: 900, isMe: false, ship: null, isGuest: false },
            { rank: 7, username: 'Me', bestScore: 100, isMe: true, ship: null, isGuest: false },
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
                isGuest: false,
            });
        }
    });
    it('counts characters as the database does, not UTF-16 units', () => {
        const astral = '\u{1F680}'.repeat(64);
        expect(row(astral).ship).toBe(astral);
    });
});

describe('parseLeaderboardRows is_guest', () => {
    const row = { player_rank: 1, username: 'Ace', best_score: 10, is_me: false, best_ship: null };
    it('reads is_guest', () => {
        expect(parseLeaderboardRows([{ ...row, is_guest: true }])[0].isGuest).toBe(true);
    });
    it('treats a missing or non-boolean is_guest as an account', () => {
        expect(parseLeaderboardRows([row])[0].isGuest).toBe(false);
        expect(parseLeaderboardRows([{ ...row, is_guest: 'yes' }])[0].isGuest).toBe(false);
    });
});

describe('isValidGuestName', () => {
    it('accepts the username alphabet at 3-20 characters', () => {
        expect(isValidGuestName('Ace Pilot_1')).toBe(true);
        expect(isValidGuestName('ab')).toBe(false);
        expect(isValidGuestName('a'.repeat(21))).toBe(false);
        expect(isValidGuestName('bad!')).toBe(false);
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
