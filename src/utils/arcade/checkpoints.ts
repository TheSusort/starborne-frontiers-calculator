import {
    CHECKPOINT_MAX_METERS,
    CHECKPOINT_MIN_METERS,
    DUEL_CREDIT_PENALTY,
    DUEL_CREDIT_REWARD,
    DUEL_WIN_BONUS,
    MAGNET_SECONDS,
    METERS_PER_UNIT,
    ROW_GAP,
    SHIELD_BREAK_FLASH,
} from './constants';
import { nextRandom } from './rng';
import { shuffledLanes, spawnRow } from './spawner';
import type { DuelEffect, DuelOutcome, DuelStakes, GameState } from './types';

const ROW_METERS = ROW_GAP * METERS_PER_UNIT;
const MIN_ROWS = Math.ceil(CHECKPOINT_MIN_METERS / ROW_METERS);
const MAX_ROWS = Math.floor(CHECKPOINT_MAX_METERS / ROW_METERS);
const STAKES: readonly DuelStakes[] = ['win-or-die', 'bonus-or-penalty', 'power-up'];

/** Rows from one checkpoint row to the next: uniform over the rows that keep the spacing
 *  inside CHECKPOINT_MIN_METERS..CHECKPOINT_MAX_METERS. */
export function drawCheckpointRows(state: GameState): number {
    return MIN_ROWS + Math.floor(nextRandom(state) * (MAX_ROWS - MIN_ROWS + 1));
}

function spawnCheckpoint(state: GameState, z: number): void {
    const lanes = shuffledLanes(state);
    state.checkpoints.push({
        id: state.nextId++,
        z,
        gates: [lanes[0], lanes[1]],
        stakes: STAKES[Math.floor(nextRandom(state) * STAKES.length)],
        resolved: false,
    });
}

/**
 * Spawns the next track row at depth `z`. With duels on, the rows immediately before and after
 * a checkpoint row stay empty, and the next checkpoint row lands exactly `drawCheckpointRows`
 * rows after the current one.
 */
export function spawnTrackRow(state: GameState, z: number): void {
    if (state.rowsUntilCheckpoint === null) {
        spawnRow(state, z);
        return;
    }
    const rows = state.rowsUntilCheckpoint--;
    if (rows === 1) return;
    if (rows === 0) {
        spawnCheckpoint(state, z);
        return;
    }
    if (rows === -1) {
        state.rowsUntilCheckpoint = drawCheckpointRows(state) - 2;
        return;
    }
    spawnRow(state, z);
}

function applyStakes(state: GameState, stakes: DuelStakes, won: boolean): DuelEffect {
    const player = state.player;
    switch (stakes) {
        case 'win-or-die':
            if (won) {
                state.bonus += DUEL_WIN_BONUS;
                return { kind: 'bonus', amount: DUEL_WIN_BONUS };
            }
            if (player.shield) {
                player.shield = false;
                state.shieldBreakTime = SHIELD_BREAK_FLASH;
                return { kind: 'shield-absorbed' };
            }
            state.status = 'over';
            return { kind: 'game-over' };
        case 'bonus-or-penalty': {
            const delta = won
                ? DUEL_CREDIT_REWARD
                : -Math.floor(state.credits * DUEL_CREDIT_PENALTY);
            state.credits += delta;
            return { kind: 'credits', delta };
        }
        case 'power-up':
            if (!won) return { kind: 'none' };
            if (nextRandom(state) < 0.5) {
                player.shield = true;
                return { kind: 'shield' };
            }
            player.magnetTime = MAGNET_SECONDS;
            return { kind: 'magnet' };
    }
}

/** Applies the pending duel's stakes and returns the game to `'running'` (or `'over'`). */
export function resolveDuel(state: GameState, outcome: DuelOutcome): DuelEffect {
    const pending = state.pendingDuel;
    if (!pending) return { kind: 'none' };
    state.pendingDuel = null;
    state.status = 'running';
    if (outcome === 'skipped') return { kind: 'none' };
    return applyStakes(state, pending.stakes, outcome === 'win');
}
