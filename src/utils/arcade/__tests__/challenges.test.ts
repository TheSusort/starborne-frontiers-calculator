import { describe, it, expect } from 'vitest';
import { createGame } from '../engine';
import { drawChallenge, spawnTrackRow } from '../checkpoints';
import type { ChallengeKind, GameState } from '../types';

/** Spawns rows through the real scheduler until `count` checkpoints exist. */
function checkpointsOf(state: GameState, count: number) {
    while (state.checkpoints.length < count) spawnTrackRow(state, 80);
    return state.checkpoints;
}

const tally = (kinds: ChallengeKind[]) =>
    kinds.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

describe('challenge draw', () => {
    it('is deterministic per seed and eligibility', () => {
        const run = (seed: number, team: boolean) =>
            checkpointsOf(createGame(seed, { duels: true, teamChallenges: team }), 40).map(
                (c) => c.challenge
            );
        expect(run(17, true)).toEqual(run(17, true));
        expect(run(17, false)).toEqual(run(17, false));
        expect(run(17, true)).not.toEqual(run(18, true));
    });

    it('never draws team when the fleet is not eligible', () => {
        for (let seed = 1; seed <= 20; seed++) {
            const kinds = checkpointsOf(createGame(seed, { duels: true }), 50).map(
                (c) => c.challenge
            );
            expect(kinds).not.toContain('team');
        }
    });

    it('draws each eligible type roughly uniformly', () => {
        const draws = (team: boolean) => {
            const g = createGame(5, { duels: true, teamChallenges: team });
            return tally(Array.from({ length: 10000 }, () => drawChallenge(g)));
        };
        const all = draws(true);
        expect(Object.keys(all).sort()).toEqual(['dps', 'duel', 'heal', 'tank', 'team']);
        for (const n of Object.values(all)) expect(Math.abs(n - 2000)).toBeLessThan(200);
        const solo = draws(false);
        expect(Object.keys(solo).sort()).toEqual(['dps', 'duel', 'heal', 'tank']);
        for (const n of Object.values(solo)) expect(Math.abs(n - 2500)).toBeLessThan(200);
    });

    it('spawns each row unpreviewed and keeps the stakes draw first', () => {
        const [c] = checkpointsOf(createGame(3, { duels: true, teamChallenges: true }), 1);
        expect(c.previewed).toBe(false);
        expect(['win-or-die', 'bonus-or-penalty', 'power-up']).toContain(c.stakes);
    });
});
