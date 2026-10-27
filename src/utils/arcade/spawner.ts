import {
    CREDIT_SPACING,
    CREDIT_TRAIL_CHANCE,
    CREDITS_PER_TRAIL,
    DOUBLE_ROW_MAX_CHANCE,
    DOUBLE_ROW_RAMP_METERS,
    POWERUP_CHANCE,
    ROW_GAP,
    SINGLE_ROW_METERS,
} from './constants';
import { nextRandom } from './rng';
import { metersTravelled } from './scoring';
import type { GameState, Lane, Obstacle, ObstacleKind, Pickup } from './types';

export function shuffledLanes(state: GameState): Lane[] {
    const lanes: Lane[] = [0, 1, 2];
    for (let i = lanes.length - 1; i > 0; i--) {
        const j = Math.floor(nextRandom(state) * (i + 1));
        [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    return lanes;
}

function pickKind(roll: number): ObstacleKind {
    if (roll < 0.4) return 'wall';
    if (roll < 0.7) return 'low';
    return 'high';
}

/**
 * Adds one row at depth `z` to `state` and returns what it added. A row holds at most two
 * obstacles in distinct lanes, so a free lane always exists; the credit trail uses a free lane.
 */
export function spawnRow(
    state: GameState,
    z: number
): { obstacles: Obstacle[]; pickups: Pickup[] } {
    const meters = metersTravelled(state.distance);
    const doubleChance =
        meters < SINGLE_ROW_METERS
            ? 0
            : Math.min(
                  DOUBLE_ROW_MAX_CHANCE,
                  (meters / DOUBLE_ROW_RAMP_METERS) * DOUBLE_ROW_MAX_CHANCE
              );
    const count = nextRandom(state) < doubleChance ? 2 : 1;
    const lanes = shuffledLanes(state);

    const obstacles: Obstacle[] = [];
    for (let i = 0; i < count; i++) {
        obstacles.push({
            id: state.nextId++,
            kind: pickKind(nextRandom(state)),
            lane: lanes[i],
            z,
            resolved: false,
        });
    }

    const pickups: Pickup[] = [];
    if (nextRandom(state) < CREDIT_TRAIL_CHANCE) {
        const lane = lanes[count];
        const powerUp =
            nextRandom(state) < POWERUP_CHANCE
                ? nextRandom(state) < 0.5
                    ? 'shield'
                    : 'magnet'
                : null;
        const start = z + ROW_GAP * 0.25;
        const trailId = state.nextId++;
        state.trails[trailId] = { pending: CREDITS_PER_TRAIL, missed: false };
        for (let i = 0; i < CREDITS_PER_TRAIL; i++) {
            pickups.push({
                id: state.nextId++,
                kind: powerUp && i === 1 ? powerUp : 'credit',
                lane,
                z: start + i * CREDIT_SPACING,
                resolved: false,
                collected: false,
                trailId,
            });
        }
    }

    state.obstacles.push(...obstacles);
    state.pickups.push(...pickups);
    return { obstacles, pickups };
}
