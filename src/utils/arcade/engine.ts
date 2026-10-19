import { blocks, canCollect } from './collision';
import {
    ACCELERATION,
    LATE_ACCELERATION,
    DESPAWN_Z,
    DUCK_SECONDS,
    FIRST_ROW_DELAY,
    JUMP_SECONDS,
    LANE_COUNT,
    MAGNET_SECONDS,
    MAX_SPEED,
    RAMP_SPEED,
    ROW_GAP,
    SHIELD_BREAK_FLASH,
    SPAWN_Z,
    START_SPEED,
} from './constants';
import { drawFirstCheckpointRows, spawnTrackRow } from './checkpoints';
import type { GameState, InputAction, Lane, PlayerState } from './types';

export interface GameOptions {
    /** Schedules duel checkpoints. Off unless the caller has two opponents to offer. */
    duels?: boolean;
}

export function createGame(seed: number, options: GameOptions = {}): GameState {
    const state: GameState = {
        rngState: seed >>> 0,
        time: 0,
        speed: START_SPEED,
        distance: 0,
        credits: 0,
        bonus: 0,
        player: { lane: 1, action: 'run', actionTime: 0, shield: false, magnetTime: 0 },
        obstacles: [],
        pickups: [],
        checkpoints: [],
        rowsUntilCheckpoint: null,
        pendingDuel: null,
        untilNextRow: FIRST_ROW_DELAY,
        nextId: 1,
        status: 'running',
        shieldBreakTime: 0,
    };
    if (options.duels) state.rowsUntilCheckpoint = drawFirstCheckpointRows(state);
    return state;
}

/** Speed after `dt` seconds of the two-phase ramp described at RAMP_SPEED. */
export function nextSpeed(speed: number, dt: number): number {
    let left = dt;
    if (speed < RAMP_SPEED) {
        const early = Math.min(left, (RAMP_SPEED - speed) / ACCELERATION);
        speed += ACCELERATION * early;
        left -= early;
    }
    return Math.min(MAX_SPEED, speed + LATE_ACCELERATION * left);
}

/** A jump or duck cannot start until the current one ends; lane changes are always allowed. */
function applyInput(player: PlayerState, action: InputAction): void {
    switch (action) {
        case 'left':
            player.lane = Math.max(0, player.lane - 1) as Lane;
            break;
        case 'right':
            player.lane = Math.min(LANE_COUNT - 1, player.lane + 1) as Lane;
            break;
        case 'jump':
            if (player.action === 'run') {
                player.action = 'jump';
                player.actionTime = JUMP_SECONDS;
            }
            break;
        case 'duck':
            if (player.action === 'run') {
                player.action = 'duck';
                player.actionTime = DUCK_SECONDS;
            }
            break;
    }
}

/**
 * Advances `state` by `dt` seconds in place and returns it. The loop calls it with
 * `STEP_SECONDS`, so behaviour does not depend on the display's frame rate.
 */
export function step(state: GameState, inputs: readonly InputAction[], dt: number): GameState {
    if (state.status !== 'running') return state;
    const player = state.player;
    for (const input of inputs) applyInput(player, input);

    if (player.action !== 'run') {
        player.actionTime -= dt;
        if (player.actionTime <= 0) {
            player.action = 'run';
            player.actionTime = 0;
        }
    }
    player.magnetTime = Math.max(0, player.magnetTime - dt);
    state.shieldBreakTime = Math.max(0, state.shieldBreakTime - dt);

    state.time += dt;
    state.speed = nextSpeed(state.speed, dt);
    const travel = state.speed * dt;
    state.distance += travel;
    for (const o of state.obstacles) o.z -= travel;
    for (const p of state.pickups) p.z -= travel;
    for (const c of state.checkpoints) c.z -= travel;

    state.untilNextRow -= travel;
    while (state.untilNextRow <= 0) {
        spawnTrackRow(state, SPAWN_Z + state.untilNextRow);
        state.untilNextRow += ROW_GAP;
    }

    for (const o of state.obstacles) {
        if (o.resolved || o.z > 0) continue;
        o.resolved = true;
        if (o.lane !== player.lane || !blocks(o.kind, player.action)) continue;
        if (player.shield) {
            player.shield = false;
            state.shieldBreakTime = SHIELD_BREAK_FLASH;
        } else {
            state.status = 'over';
        }
    }

    if (state.status === 'over') return state;

    for (const p of state.pickups) {
        if (p.resolved || p.z > 0) continue;
        p.resolved = true;
        if (!canCollect(p, player)) continue;
        p.collected = true;
        if (p.kind === 'credit') state.credits++;
        else if (p.kind === 'shield') player.shield = true;
        else player.magnetTime = MAGNET_SECONDS;
    }

    for (const c of state.checkpoints) {
        if (c.resolved || c.z > 0) continue;
        c.resolved = true;
        const slot = c.gates.indexOf(player.lane);
        if (slot === -1) continue;
        state.status = 'duel';
        state.pendingDuel = { checkpointId: c.id, slot: slot as 0 | 1, stakes: c.stakes };
    }

    state.obstacles = state.obstacles.filter((o) => o.z > DESPAWN_Z);
    state.pickups = state.pickups.filter((p) => p.z > DESPAWN_Z && !p.collected);
    state.checkpoints = state.checkpoints.filter((c) => c.z > DESPAWN_Z);
    return state;
}
