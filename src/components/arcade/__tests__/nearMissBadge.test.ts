import { describe, it, expect } from 'vitest';
import { NO_NEAR_MISS, nextNearMissBadge } from '../nearMissBadge';
import type { RunEvent } from '../../../utils/arcade/types';

const miss = (chain: number, points: number): RunEvent => ({
    kind: 'near-miss',
    chain,
    points,
    lane: 1,
});

describe('nextNearMissBadge', () => {
    it('shows the latest near miss of the frame', () => {
        const b = nextNearMissBadge(NO_NEAR_MISS, [miss(1, 25), miss(2, 50)], 2);
        expect(b).toMatchObject({ state: 'on', chain: 2, points: 50 });
        expect(b.pulse).toBe(2);
    });

    it('is unchanged by a frame with no near miss while the chain runs', () => {
        const on = nextNearMissBadge(NO_NEAR_MISS, [miss(1, 25)], 1);
        expect(nextNearMissBadge(on, [{ kind: 'streak-on' }], 1)).toBe(on);
    });

    it('turns lost, keeping its figures, when the chain ends', () => {
        const on = nextNearMissBadge(NO_NEAR_MISS, [miss(3, 75)], 3);
        const lost = nextNearMissBadge(on, [], 0);
        expect(lost).toMatchObject({ state: 'lost', chain: 3, points: 75, pulse: on.pulse + 1 });
        expect(nextNearMissBadge(lost, [], 0)).toBe(lost);
    });

    it('a near miss in the frame that ended the chain still shows as on', () => {
        const on = nextNearMissBadge(NO_NEAR_MISS, [miss(4, 100)], 4);
        expect(nextNearMissBadge(on, [miss(1, 25)], 1)).toMatchObject({ state: 'on', chain: 1 });
    });
});
