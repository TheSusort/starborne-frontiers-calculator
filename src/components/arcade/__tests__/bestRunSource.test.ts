import { describe, it, expect } from 'vitest';
import { formatRunStats, pickBestRun } from '../bestRunSource';
import type { ArcadeLeaderboardEntry } from '../../../utils/arcade/leaderboardRows';

const entry = (over: Partial<ArcadeLeaderboardEntry>): ArcadeLeaderboardEntry => ({
    rank: 4,
    username: 'Me',
    bestScore: 900,
    isMe: true,
    ship: null,
    isGuest: false,
    distance: 6420,
    credits: 312,
    ...over,
});

describe('pickBestRun', () => {
    it("prefers the viewer's own leaderboard row, with its rank", () => {
        const rows = [entry({ isMe: false, rank: 1, bestScore: 2000 }), entry({})];
        expect(pickBestRun(rows, { score: 500, distance: 1, credits: 1 })).toEqual({
            score: 900,
            distance: 6420,
            credits: 312,
            rank: 4,
        });
    });
    it('falls back to the local run with no rank', () => {
        expect(
            pickBestRun([entry({ isMe: false })], { score: 500, distance: 100, credits: 7 })
        ).toEqual({ score: 500, distance: 100, credits: 7, rank: null });
    });
    it('keeps null distance and credits from either source', () => {
        expect(pickBestRun([entry({ distance: null, credits: null })], null)).toMatchObject({
            distance: null,
            credits: null,
        });
        expect(pickBestRun([], { score: 500, distance: null, credits: null })).toMatchObject({
            distance: null,
            credits: null,
        });
    });
    it('is null when there is no run at all', () => {
        expect(pickBestRun([], null)).toBeNull();
        expect(pickBestRun([], { score: 0, distance: null, credits: null })).toBeNull();
    });
});

describe('formatRunStats', () => {
    it('joins distance and credits, dashing a missing half', () => {
        expect(formatRunStats(6420, 312)).toBe('6,420 m \u00b7 312 credits');
        expect(formatRunStats(null, 312)).toBe('\u2013 \u00b7 312 credits');
    });
    it('is empty when both are missing, so no run line renders', () => {
        expect(formatRunStats(null, null)).toBe('');
    });
});
