import { CREDIT_POINTS, METERS_PER_UNIT } from './constants';
import type { GameState, RunResult } from './types';

export function metersTravelled(distanceUnits: number): number {
    return Math.floor(distanceUnits * METERS_PER_UNIT);
}

export function computeScore(state: GameState): number {
    return metersTravelled(state.distance) + state.credits * CREDIT_POINTS;
}

export function runResult(state: GameState): RunResult {
    return {
        score: computeScore(state),
        credits: state.credits,
        distance: metersTravelled(state.distance),
    };
}
