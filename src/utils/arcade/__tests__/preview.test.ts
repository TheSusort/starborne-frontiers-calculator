import { describe, it, expect } from 'vitest';
import { createGame, PREVIEW_TOTAL_SECONDS, previewScale, step } from '../engine';
import { computeScore } from '../scoring';
import {
    JUMP_SECONDS,
    MAX_SPEED,
    PREVIEW_EASE_SECONDS,
    PREVIEW_SCALE,
    PREVIEW_SECONDS,
    PREVIEW_TRAVEL_AT_MAX,
    PREVIEW_Z,
    SPAWN_Z,
    STEP_SECONDS,
} from '../constants';
import type { GameState, InputAction, Lane, RunEvent } from '../types';

/** Steps that would carry a row from SPAWN_Z past the player many times over; a loop that
 *  reaches it has stalled. */
const MAX_STEPS = 120 * 60;

/** A quiet game at top speed with one checkpoint row at `z`, by default with its gates outside
 *  the player's lane. */
function rowAhead(z = SPAWN_Z, gates: [Lane, Lane] = [0, 2]): GameState {
    const g = createGame(1, { duels: true });
    g.untilNextRow = Number.POSITIVE_INFINITY;
    g.speed = MAX_SPEED;
    g.checkpoints.push({
        id: 7,
        z,
        gates,
        stakes: 'power-up',
        challenge: 'dps',
        previewed: false,
        resolved: false,
    });
    return g;
}

describe('previewScale', () => {
    it('eases down, holds, eases back up, then stays at 1', () => {
        expect(previewScale(0)).toBe(1);
        expect(previewScale(PREVIEW_EASE_SECONDS / 2)).toBeCloseTo((1 + PREVIEW_SCALE) / 2);
        expect(previewScale(PREVIEW_EASE_SECONDS)).toBe(PREVIEW_SCALE);
        expect(previewScale(PREVIEW_EASE_SECONDS + PREVIEW_SECONDS)).toBe(PREVIEW_SCALE);
        expect(previewScale(PREVIEW_TOTAL_SECONDS)).toBe(1);
        expect(previewScale(PREVIEW_TOTAL_SECONDS + 5)).toBe(1);
    });

    it('starts inside the spawn depth and covers less than PREVIEW_Z at top speed', () => {
        expect(PREVIEW_Z).toBeLessThan(SPAWN_Z);
        expect(PREVIEW_TRAVEL_AT_MAX).toBeLessThan(PREVIEW_Z);
    });
});

describe('checkpoint preview', () => {
    it('reaches PREVIEW_SCALE and is back to 1 before the row crosses at MAX_SPEED', () => {
        const g = rowAhead();
        const row = g.checkpoints[0];
        let min = 1;
        let started = false;
        let held = 0;
        for (let i = 0; i < MAX_STEPS && !row.resolved; i++) {
            step(g, [], STEP_SECONDS);
            if (g.preview) {
                started = true;
                expect(g.preview.checkpointId).toBe(7);
            }
            if (g.timeScale === PREVIEW_SCALE) held++;
            min = Math.min(min, g.timeScale);
            if (row.z <= 0) break;
        }
        expect(started).toBe(true);
        expect(min).toBe(PREVIEW_SCALE);
        // The hold counts real steps, not scaled engine time.
        expect(held * STEP_SECONDS).toBeCloseTo(PREVIEW_SECONDS, 1);
        expect(g.timeScale).toBe(1);
        expect(g.preview).toBeNull();
        expect(row.previewed).toBe(true);
    });

    it('starts when the row comes within PREVIEW_Z, and only once per row', () => {
        const g = rowAhead(PREVIEW_Z + 1);
        step(g, [], STEP_SECONDS);
        expect(g.preview).toBeNull();
        for (let i = 0; i < MAX_STEPS && g.checkpoints[0].z > PREVIEW_Z; i++) {
            step(g, [], STEP_SECONDS);
        }
        expect(g.preview).toEqual({ checkpointId: 7, elapsed: 0 });
        let starts = 0;
        for (let i = 0; i < MAX_STEPS && !g.checkpoints[0]?.resolved; i++) {
            const before = g.preview;
            step(g, [], STEP_SECONDS);
            if (!before && g.preview) starts++;
        }
        expect(starts).toBe(0);
    });

    it('slows travel and the engine clock by the scale', () => {
        const g = rowAhead(PREVIEW_Z);
        step(g, [], STEP_SECONDS);
        // Into the hold.
        for (let t = 0; t < PREVIEW_EASE_SECONDS + 0.1; t += STEP_SECONDS)
            step(g, [], STEP_SECONDS);
        expect(g.timeScale).toBe(PREVIEW_SCALE);
        const { time, distance } = g;
        step(g, [], STEP_SECONDS);
        expect(g.time - time).toBeCloseTo(STEP_SECONDS * PREVIEW_SCALE);
        expect(g.distance - distance).toBeCloseTo(MAX_SPEED * STEP_SECONDS * PREVIEW_SCALE);
    });

    it('applies lane changes and jumps during the preview, a jump lasting longer in real time', () => {
        // The player leaves its gate lane for the free one, so crossing the row starts no duel.
        const g = rowAhead(PREVIEW_Z, [1, 2]);
        step(g, [], STEP_SECONDS);
        for (let t = 0; t < PREVIEW_EASE_SECONDS + 0.1; t += STEP_SECONDS)
            step(g, [], STEP_SECONDS);
        expect(g.timeScale).toBe(PREVIEW_SCALE);
        step(g, ['left'], STEP_SECONDS);
        expect(g.player.lane).toBe(0);
        step(g, ['jump'], STEP_SECONDS);
        expect(g.player.action).toBe('jump');
        const startedAt = g.time;
        let steps = 0;
        while (g.player.action === 'jump' && steps < MAX_STEPS) {
            step(g, [], STEP_SECONDS);
            steps++;
        }
        // The jump lasts its usual engine time, which the preview stretches in real time.
        expect(g.time - startedAt).toBeCloseTo(JUMP_SECONDS, 1);
        expect(steps * STEP_SECONDS).toBeGreaterThan(2 * JUMP_SECONDS);
    });

    it('replays the same distance, score and events for the same seed and inputs', () => {
        const play = () => {
            const g = createGame(99, { duels: true, teamChallenges: true });
            const events: RunEvent[] = [];
            const scales: number[] = [];
            const script: InputAction[] = ['left', 'jump', 'right', 'duck', 'right', 'left'];
            for (let i = 0; i < 120 * 90 && g.status !== 'over'; i++) {
                // A fresh shield every step keeps the run alive through the first checkpoints.
                g.player.shield = true;
                const inputs = i % 97 === 0 ? [script[(i / 97) % script.length]] : [];
                step(g, inputs, STEP_SECONDS);
                events.push(...g.events);
                g.events.length = 0;
                scales.push(g.timeScale);
                if (g.status === 'duel') {
                    g.status = 'running';
                    g.pendingDuel = null;
                }
            }
            return { distance: g.distance, score: computeScore(g), events, scales };
        };
        const a = play();
        const b = play();
        expect(a).toEqual(b);
        expect(Math.min(...a.scales)).toBe(PREVIEW_SCALE);
    });
});
