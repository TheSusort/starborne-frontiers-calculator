import { describe, it, expect } from 'vitest';
import { createGame, step } from '../engine';
import {
    drawCheckpointRows,
    drawFirstCheckpointRows,
    resolveDuel,
    spawnTrackRow,
} from '../checkpoints';
import { computeScore } from '../scoring';
import {
    CHECKPOINT_MAX_METERS,
    CHECKPOINT_MIN_METERS,
    FIRST_CHECKPOINT_MAX_METERS,
    FIRST_CHECKPOINT_MIN_METERS,
    MAGNET_SECONDS,
    METERS_PER_UNIT,
    ROW_GAP,
    STEP_SECONDS,
} from '../constants';
import type { DuelStakes, GameState, Lane } from '../types';

const ROW_METERS = ROW_GAP * METERS_PER_UNIT;

/** Spawns `rows` rows through the real scheduler and reports what each row index got. */
function spawnRows(state: GameState, rows: number) {
    const log: { index: number; obstacles: number; pickups: number; checkpoint: boolean }[] = [];
    for (let i = 0; i < rows; i++) {
        const o = state.obstacles.length;
        const p = state.pickups.length;
        const c = state.checkpoints.length;
        spawnTrackRow(state, 80);
        log.push({
            index: i,
            obstacles: state.obstacles.length - o,
            pickups: state.pickups.length - p,
            checkpoint: state.checkpoints.length > c,
        });
    }
    return log;
}

function gameAtDuel(stakes: DuelStakes): GameState {
    const g = createGame(7, { duels: true });
    g.status = 'duel';
    g.pendingDuel = { checkpointId: 1, slot: 0, stakes };
    return g;
}

describe('checkpoint scheduling', () => {
    it('places the first checkpoint 200–400 m in, then spaces them 300–700 m apart', () => {
        expect([FIRST_CHECKPOINT_MIN_METERS, FIRST_CHECKPOINT_MAX_METERS]).toEqual([200, 400]);
        expect([CHECKPOINT_MIN_METERS, CHECKPOINT_MAX_METERS]).toEqual([300, 700]);
        for (let seed = 1; seed <= 40; seed++) {
            const g = createGame(seed, { duels: true });
            const log = spawnRows(g, 2000);
            const at = log.filter((r) => r.checkpoint).map((r) => r.index);
            expect(at.length).toBeGreaterThan(10);
            // The first checkpoint's distance is measured from the start of the track.
            expect(at[0] * ROW_METERS).toBeGreaterThanOrEqual(FIRST_CHECKPOINT_MIN_METERS);
            expect(at[0] * ROW_METERS).toBeLessThanOrEqual(FIRST_CHECKPOINT_MAX_METERS);
            for (let i = 1; i < at.length; i++) {
                const metres = (at[i] - at[i - 1]) * ROW_METERS;
                expect(metres).toBeGreaterThanOrEqual(CHECKPOINT_MIN_METERS);
                expect(metres).toBeLessThanOrEqual(CHECKPOINT_MAX_METERS);
            }
        }
    });

    it('draws first-checkpoint row counts across the whole first range', () => {
        const g = createGame(3, { duels: true });
        const draws = Array.from({ length: 2000 }, () => drawFirstCheckpointRows(g));
        expect(Math.min(...draws)).toBe(Math.ceil(FIRST_CHECKPOINT_MIN_METERS / ROW_METERS));
        expect(Math.max(...draws)).toBe(Math.floor(FIRST_CHECKPOINT_MAX_METERS / ROW_METERS));
    });

    it('draws later row counts across the whole range', () => {
        const g = createGame(3, { duels: true });
        const draws = Array.from({ length: 2000 }, () => drawCheckpointRows(g));
        expect(Math.min(...draws)).toBe(Math.ceil(CHECKPOINT_MIN_METERS / ROW_METERS));
        expect(Math.max(...draws)).toBe(Math.floor(CHECKPOINT_MAX_METERS / ROW_METERS));
    });

    it('starts a duel run with the first-checkpoint draw', () => {
        const rows = createGame(3, { duels: true }).rowsUntilCheckpoint ?? 0;
        expect(rows * ROW_METERS).toBeGreaterThanOrEqual(FIRST_CHECKPOINT_MIN_METERS);
        expect(rows * ROW_METERS).toBeLessThanOrEqual(FIRST_CHECKPOINT_MAX_METERS);
    });

    it('leaves the rows before and after a checkpoint empty', () => {
        const g = createGame(11, { duels: true });
        const log = spawnRows(g, 1500);
        for (const row of log.filter((r) => r.checkpoint)) {
            const before = log[row.index - 1];
            const after = log[row.index + 1];
            expect(before.obstacles + before.pickups).toBe(0);
            expect(after.obstacles + after.pickups).toBe(0);
            expect(row.obstacles + row.pickups).toBe(0);
        }
    });

    it('puts two gates in distinct lanes and leaves one lane free', () => {
        const g = createGame(5, { duels: true });
        spawnRows(g, 3000);
        expect(g.checkpoints.length).toBeGreaterThan(5);
        for (const c of g.checkpoints) {
            expect(c.gates[0]).not.toBe(c.gates[1]);
        }
    });

    it('draws every stakes kind', () => {
        const g = createGame(9, { duels: true });
        spawnRows(g, 20000);
        const kinds = new Set(g.checkpoints.map((c) => c.stakes));
        expect(kinds).toEqual(new Set(['win-or-die', 'bonus-or-penalty', 'power-up']));
    });

    it('schedules nothing when duels are off', () => {
        const g = createGame(5);
        expect(g.rowsUntilCheckpoint).toBeNull();
        spawnRows(g, 3000);
        expect(g.checkpoints).toHaveLength(0);
        expect(createGame(5, { duels: false }).rowsUntilCheckpoint).toBeNull();
    });

    it('is deterministic by seed', () => {
        const a = createGame(42, { duels: true });
        const b = createGame(42, { duels: true });
        spawnRows(a, 1000);
        spawnRows(b, 1000);
        expect(a.checkpoints).toEqual(b.checkpoints);
        expect(a.obstacles).toEqual(b.obstacles);
    });
});

describe('crossing a checkpoint', () => {
    function crossing(gates: [Lane, Lane], lane: Lane, action: 'run' | 'jump' | 'duck' = 'run') {
        const g = createGame(1, { duels: true });
        g.untilNextRow = Number.POSITIVE_INFINITY;
        g.player.lane = lane;
        g.player.action = action;
        g.player.actionTime = action === 'run' ? 0 : 10;
        g.checkpoints.push({ id: 50, z: 0.01, gates, stakes: 'power-up', resolved: false });
        return step(g, [], STEP_SECONDS);
    }

    it('requests a duel when the player is in a gate lane', () => {
        const g = crossing([0, 2], 2);
        expect(g.status).toBe('duel');
        expect(g.pendingDuel).toEqual({ checkpointId: 50, slot: 1, stakes: 'power-up' });
    });

    it('requests a duel whether jumping or ducking', () => {
        expect(crossing([0, 1], 0, 'jump').status).toBe('duel');
        expect(crossing([0, 1], 1, 'duck').status).toBe('duel');
    });

    it('does nothing in the empty lane', () => {
        const g = crossing([0, 2], 1);
        expect(g.status).toBe('running');
        expect(g.pendingDuel).toBeNull();
    });

    it('freezes the game while a duel is pending', () => {
        const g = crossing([0, 2], 0);
        const distance = g.distance;
        step(g, ['left'], STEP_SECONDS);
        expect(g.distance).toBe(distance);
    });
});

describe('resolveDuel', () => {
    it('win-or-die: a win adds 500 bonus', () => {
        const g = gameAtDuel('win-or-die');
        expect(resolveDuel(g, 'win')).toEqual({ kind: 'bonus', amount: 500 });
        expect(g.bonus).toBe(500);
        expect(g.status).toBe('running');
        expect(g.pendingDuel).toBeNull();
    });

    it('win-or-die: a loss ends the run', () => {
        const g = gameAtDuel('win-or-die');
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'game-over' });
        expect(g.status).toBe('over');
    });

    it('win-or-die: a shield absorbs the loss and is consumed', () => {
        const g = gameAtDuel('win-or-die');
        g.player.shield = true;
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'shield-absorbed' });
        expect(g.player.shield).toBe(false);
        expect(g.shieldBreakTime).toBeGreaterThan(0);
        expect(g.status).toBe('running');
    });

    it('bonus-or-penalty: a win adds 25 credits', () => {
        const g = gameAtDuel('bonus-or-penalty');
        g.credits = 10;
        expect(resolveDuel(g, 'win')).toEqual({ kind: 'credits', delta: 25 });
        expect(g.credits).toBe(35);
    });

    it('bonus-or-penalty: a loss takes a quarter of the credits, rounded down', () => {
        const g = gameAtDuel('bonus-or-penalty');
        g.credits = 49;
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'credits', delta: -12 });
        expect(g.credits).toBe(37);
    });

    it('power-up: a win grants a shield or a magnet, both reachable', () => {
        const kinds = new Set<string>();
        for (let seed = 1; seed <= 30; seed++) {
            const g = gameAtDuel('power-up');
            g.rngState = seed;
            const effect = resolveDuel(g, 'win');
            kinds.add(effect.kind);
            if (effect.kind === 'shield') expect(g.player.shield).toBe(true);
            else expect(g.player.magnetTime).toBe(MAGNET_SECONDS);
        }
        expect(kinds).toEqual(new Set(['shield', 'magnet']));
    });

    it('power-up: a loss does nothing', () => {
        const g = gameAtDuel('power-up');
        expect(resolveDuel(g, 'lose')).toEqual({ kind: 'none' });
        expect(g.player.shield).toBe(false);
        expect(g.player.magnetTime).toBe(0);
    });

    it('skipped applies nothing for every stakes kind', () => {
        for (const stakes of ['win-or-die', 'bonus-or-penalty', 'power-up'] as const) {
            const g = gameAtDuel(stakes);
            g.credits = 40;
            expect(resolveDuel(g, 'skipped')).toEqual({ kind: 'none' });
            expect(g.credits).toBe(40);
            expect(g.bonus).toBe(0);
            expect(g.status).toBe('running');
        }
    });

    it('does nothing without a pending duel', () => {
        const g = createGame(1, { duels: true });
        expect(resolveDuel(g, 'win')).toEqual({ kind: 'none' });
        expect(g.bonus).toBe(0);
    });
});

describe('score', () => {
    it('includes the duel bonus', () => {
        const g = createGame(1);
        g.credits = 3;
        g.bonus = 500;
        expect(computeScore(g)).toBe(30 + 500);
    });
});
