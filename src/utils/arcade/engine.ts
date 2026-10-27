import { blocks, canCollect, jumpArc } from './collision';
import {
    ACCELERATION,
    LATE_ACCELERATION,
    DESPAWN_Z,
    DROP_SECONDS,
    DUCK_SECONDS,
    FIRST_ROW_DELAY,
    INPUT_BUFFER_SECONDS,
    JUMP_SECONDS,
    LANE_COUNT,
    MAGNET_SECONDS,
    MAX_SPEED,
    NEAR_MISS_CHAIN_SECONDS,
    NEAR_MISS_MAX_POINTS,
    NEAR_MISS_POINTS,
    NEAR_MISS_SECONDS,
    RAMP_SPEED,
    ROW_GAP,
    SHIELD_BREAK_FLASH,
    SPAWN_Z,
    START_SPEED,
    STREAK_CREDIT_VALUE,
    STREAK_TRAILS,
} from './constants';
import { drawFirstCheckpointRows, spawnTrackRow } from './checkpoints';
import type { GameState, InputAction, Lane, Obstacle, Pickup } from './types';

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
        events: [],
        nearMissChain: 0,
        lastNearMissTime: Number.NEGATIVE_INFINITY,
        bestNearMissChain: 0,
        nearMissPoints: 0,
        creditStreak: 0,
        trails: {},
        player: {
            lane: 1,
            action: 'run',
            actionTime: 0,
            dropArc: 0,
            actionStartedAt: Number.NEGATIVE_INFINITY,
            laneLeftAt: [
                Number.NEGATIVE_INFINITY,
                Number.NEGATIVE_INFINITY,
                Number.NEGATIVE_INFINITY,
            ],
            buffered: null,
            shield: false,
            magnetTime: 0,
        },
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

/**
 * Starts a jump or duck if the current action allows it, and reports whether it did. A jump
 * starts from running or ducking (ending the duck); a duck starts from running, or from a jump
 * as a drop that turns into the duck. Nothing starts during a drop, or over the same action.
 */
function tryStart(state: GameState, action: 'jump' | 'duck'): boolean {
    const player = state.player;
    if (action === 'jump') {
        if (player.action !== 'run' && player.action !== 'duck') return false;
        player.action = 'jump';
        player.actionTime = JUMP_SECONDS;
    } else if (player.action === 'jump') {
        player.dropArc = jumpArc(player.actionTime);
        player.action = 'drop';
        player.actionTime = DROP_SECONDS;
    } else if (player.action === 'run') {
        player.action = 'duck';
        player.actionTime = DUCK_SECONDS;
    } else {
        return false;
    }
    player.actionStartedAt = state.time;
    return true;
}

/** Lane changes apply at once. A jump or duck that cannot start now is held for
 *  INPUT_BUFFER_SECONDS (see `step`); any jump or duck press replaces the one held. */
function applyInput(state: GameState, action: InputAction): void {
    const player = state.player;
    switch (action) {
        case 'left':
        case 'right': {
            const lane = (
                action === 'left'
                    ? Math.max(0, player.lane - 1)
                    : Math.min(LANE_COUNT - 1, player.lane + 1)
            ) as Lane;
            if (lane !== player.lane) player.laneLeftAt[player.lane] = state.time;
            player.lane = lane;
            break;
        }
        case 'jump':
        case 'duck':
            player.buffered = tryStart(state, action) ? null : { action, age: 0 };
            break;
    }
}

/**
 * An obstacle that crossed without hitting is a near miss when, at most NEAR_MISS_SECONDS
 * before the crossing, the player left its lane, or (in its lane) started the jump that clears a
 * low barrier or the duck that clears a high one. A wall only counts lane changes.
 */
function isNearMiss(state: GameState, o: Obstacle): boolean {
    const player = state.player;
    const recent = (at: number) => state.time - at <= NEAR_MISS_SECONDS;
    if (recent(player.laneLeftAt[o.lane])) return true;
    if (o.lane !== player.lane || !recent(player.actionStartedAt)) return false;
    if (o.kind === 'low') return player.action === 'jump';
    if (o.kind === 'high') return player.action === 'duck';
    return false;
}

function payNearMiss(state: GameState, lane: Lane): void {
    const chain = ++state.nearMissChain;
    const points = Math.min(NEAR_MISS_POINTS * chain, NEAR_MISS_MAX_POINTS);
    state.lastNearMissTime = state.time;
    state.bestNearMissChain = Math.max(state.bestNearMissChain, chain);
    state.nearMissPoints += points;
    state.bonus += points;
    state.events.push({ kind: 'near-miss', points, chain, lane });
}

/**
 * Counts a resolved pickup against its trail. Once every pickup of the trail has resolved, the
 * trail is decided: with every credit collected it adds one to the streak, otherwise the streak
 * resets. Power-ups never decide whether a trail is finished.
 */
function settleTrail(state: GameState, p: Pickup): void {
    const trail = state.trails[p.trailId];
    if (!trail) return;
    trail.pending--;
    if (p.kind === 'credit' && !p.collected) trail.missed = true;
    if (trail.pending > 0) return;
    delete state.trails[p.trailId];
    if (trail.missed) {
        if (state.creditStreak >= STREAK_TRAILS) state.events.push({ kind: 'streak-lost' });
        state.creditStreak = 0;
    } else if (++state.creditStreak === STREAK_TRAILS) {
        state.events.push({ kind: 'streak-on' });
    }
}

/**
 * Advances `state` by `dt` seconds in place and returns it. The loop calls it with
 * `STEP_SECONDS`, so behaviour does not depend on the display's frame rate.
 */
export function step(state: GameState, inputs: readonly InputAction[], dt: number): GameState {
    if (state.status !== 'running') return state;
    const player = state.player;
    for (const input of inputs) applyInput(state, input);

    if (player.action !== 'run') {
        player.actionTime -= dt;
        if (player.action === 'drop' && player.actionTime <= 0) {
            player.action = 'duck';
            player.actionTime += DUCK_SECONDS;
        } else if (player.actionTime <= 0) {
            player.action = 'run';
            player.actionTime = 0;
        }
    }
    const held = player.buffered;
    if (held) {
        if (tryStart(state, held.action)) player.buffered = null;
        else if ((held.age += dt) > INPUT_BUFFER_SECONDS) player.buffered = null;
    }
    player.magnetTime = Math.max(0, player.magnetTime - dt);
    state.shieldBreakTime = Math.max(0, state.shieldBreakTime - dt);

    state.time += dt;
    if (state.time - state.lastNearMissTime > NEAR_MISS_CHAIN_SECONDS) state.nearMissChain = 0;
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
        if (o.lane !== player.lane || !blocks(o.kind, player.action)) {
            if (isNearMiss(state, o)) payNearMiss(state, o.lane);
            continue;
        }
        state.nearMissChain = 0;
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
        if (canCollect(p, player)) {
            p.collected = true;
            if (p.kind === 'credit') {
                state.credits += state.creditStreak >= STREAK_TRAILS ? STREAK_CREDIT_VALUE : 1;
            } else if (p.kind === 'shield') player.shield = true;
            else player.magnetTime = MAGNET_SECONDS;
        }
        settleTrail(state, p);
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
