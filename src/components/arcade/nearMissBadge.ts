import type { RunEvent } from '../../utils/arcade/types';

/** The HUD's near-miss callout beside the score: shown while a chain runs, fading out once it
 *  ends; `pulse` counts the changes, so each one replays its animation. */
export interface NearMissBadge {
    state: 'off' | 'on' | 'lost';
    /** The chain's length and the points its latest near miss paid. */
    chain: number;
    points: number;
    pulse: number;
}

export const NO_NEAR_MISS: NearMissBadge = { state: 'off', chain: 0, points: 0, pulse: 0 };

/** The badge after one frame's `events`, given the game's chain once they have run
 *  (`GameState.nearMissChain`). Returns `badge` itself when nothing changed. */
export function nextNearMissBadge(
    badge: NearMissBadge,
    events: readonly RunEvent[],
    chain: number
): NearMissBadge {
    let next = badge;
    for (const e of events) {
        if (e.kind !== 'near-miss') continue;
        next = { state: 'on', chain: e.chain, points: e.points, pulse: next.pulse + 1 };
    }
    if (next.state === 'on' && chain === 0)
        next = { ...next, state: 'lost', pulse: next.pulse + 1 };
    return next;
}
