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
    NEAR_MISS_MAX_POINTS,
    NEAR_MISS_POINTS,
    NEAR_MISS_SECONDS,
    PREVIEW_EASE_SECONDS,
    PREVIEW_SCALE,
    PREVIEW_LEAD_SECONDS,
    PREVIEW_SECONDS,
    PREVIEW_TRAVEL_SECONDS,
    PREVIEW_Z,
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
    /** Lets checkpoint rows draw the `team` challenge. Off unless the caller can field its picks
     *  (see `canTeam`). */
    teamChallenges?: boolean;
}

export function createGame(seed: number, options: GameOptions = {}): GameState {
    const state: GameState = {
        seed: seed >>> 0,
        rngState: seed >>> 0,
        teamChallenges: !!options.teamChallenges,
        timeScale: 1,
        preview: null,
        time: 0,
        speed: START_SPEED,
        distance: 0,
        credits: 0,
        bonus: 0,
        events: [],
        nearMissChain: 0,
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

/** Real seconds a whole checkpoint preview lasts: both eases and the hold. */
export const PREVIEW_TOTAL_SECONDS = PREVIEW_SECONDS + 2 * PREVIEW_EASE_SECONDS;

/** The time scale `elapsed` real seconds into a checkpoint preview: a linear ease from 1 down to
 *  PREVIEW_SCALE, the hold, a linear ease back up, then 1. */
export function previewScale(elapsed: number): number {
    const ease = (t: number) => 1 - (1 - PREVIEW_SCALE) * Math.min(1, Math.max(0, t));
    if (elapsed < PREVIEW_EASE_SECONDS) return ease(elapsed / PREVIEW_EASE_SECONDS);
    const out = elapsed - PREVIEW_EASE_SECONDS - PREVIEW_SECONDS;
    if (out <= 0) return PREVIEW_SCALE;
    return ease(1 - out / PREVIEW_EASE_SECONDS);
}

/** Moves the running preview on by `realDt` real seconds, ending it once it has run its course,
 *  and returns the time scale for this step. */
function advancePreview(state: GameState, realDt: number): number {
    const preview = state.preview;
    if (preview) {
        preview.elapsed += realDt;
        if (preview.elapsed >= PREVIEW_TOTAL_SECONDS) state.preview = null;
    }
    state.timeScale = state.preview ? previewScale(state.preview.elapsed) : 1;
    return state.timeScale;
}

/** Depth at which a checkpoint row's preview starts at `speed`: the preview ends
 *  PREVIEW_LEAD_SECONDS before the row reaches the player, capped at PREVIEW_Z. */
export function previewStartZ(speed: number): number {
    return Math.min(PREVIEW_Z, speed * (PREVIEW_TRAVEL_SECONDS + PREVIEW_LEAD_SECONDS));
}

/** Starts the preview of the first row to come within `previewStartZ`, unless one is running. */
function startPreview(state: GameState): void {
    if (state.preview) return;
    const startZ = previewStartZ(state.speed);
    for (const c of state.checkpoints) {
        if (c.previewed || c.resolved || c.z > startZ) continue;
        c.previewed = true;
        state.preview = { checkpointId: c.id, elapsed: 0 };
        return;
    }
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
 * Advances `state` by `realDt` real seconds in place and returns it. The loop calls it with
 * `STEP_SECONDS`, so behaviour does not depend on the display's frame rate. Every rule runs on
 * engine time, `realDt` times the time scale (see `previewScale`); only the preview's own clock
 * counts real time.
 */
export function step(state: GameState, inputs: readonly InputAction[], realDt: number): GameState {
    if (state.status !== 'running') return state;
    const dt = realDt * advancePreview(state, realDt);
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
    state.speed = nextSpeed(state.speed, dt);
    const travel = state.speed * dt;
    state.distance += travel;
    for (const o of state.obstacles) o.z -= travel;
    for (const p of state.pickups) p.z -= travel;
    for (const c of state.checkpoints) c.z -= travel;
    startPreview(state);

    state.untilNextRow -= travel;
    while (state.untilNextRow <= 0) {
        spawnTrackRow(state, SPAWN_Z + state.untilNextRow);
        state.untilNextRow += ROW_GAP;
    }

    // A row's obstacles share one z, and rows are ROW_GAP apart, so the obstacles crossing in
    // one step are one row. A row with no near miss in it ends the chain.
    let crossed = false;
    let nearMissed = false;
    for (const o of state.obstacles) {
        if (o.resolved || o.z > 0) continue;
        o.resolved = true;
        crossed = true;
        if (o.lane !== player.lane || !blocks(o.kind, player.action)) {
            if (isNearMiss(state, o)) {
                payNearMiss(state, o.lane);
                nearMissed = true;
            }
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
    if (crossed && !nearMissed) state.nearMissChain = 0;

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
        state.pendingDuel = {
            checkpointId: c.id,
            slot: slot as 0 | 1,
            stakes: c.stakes,
            challenge: c.challenge,
        };
    }

    state.obstacles = state.obstacles.filter((o) => o.z > DESPAWN_Z);
    state.pickups = state.pickups.filter((p) => p.z > DESPAWN_Z && !p.collected);
    state.checkpoints = state.checkpoints.filter((c) => c.z > DESPAWN_Z);
    return state;
}
