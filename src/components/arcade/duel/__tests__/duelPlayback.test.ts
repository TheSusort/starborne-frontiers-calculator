import { describe, expect, it } from 'vitest';
import { beatSeconds, MAX_PLAYBACK_SECONDS } from '../duelPlayback';

describe('beatSeconds', () => {
    it('is half a second a turn until the fight would run past the cap, then shrinks to fit', () => {
        expect(beatSeconds(4)).toBe(0.5);
        expect(beatSeconds(20)).toBe(0.5);
        expect(beatSeconds(40)).toBe(MAX_PLAYBACK_SECONDS / 40);
        expect(beatSeconds(40) * 40).toBeLessThanOrEqual(MAX_PLAYBACK_SECONDS);
        expect(beatSeconds(0)).toBe(0);
    });
});
