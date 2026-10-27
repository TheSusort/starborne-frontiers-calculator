import { describe, expect, it } from 'vitest';
import { BEATS_PER_BAR, beatPulse, OFF_BAR_PEAK, PULSE_DECAY, TRACK_BEATS } from '../beats';
import { SYNTHWAVE_TRACKS } from '../synthwaveMusic';

const grid = { bpm: 120, firstBeat: 0.5 };
/** Seconds per beat at 120 bpm. */
const BEAT = 0.5;

describe('beatPulse', () => {
    it('peaks at 1 on the bar’s first beat and lower on the others', () => {
        expect(beatPulse(0.5, grid, true)).toBeCloseTo(1);
        expect(beatPulse(0.5 + BEAT, grid, true)).toBeCloseTo(OFF_BAR_PEAK);
        expect(beatPulse(0.5 + 3 * BEAT, grid, true)).toBeCloseTo(OFF_BAR_PEAK);
        expect(beatPulse(0.5 + BEATS_PER_BAR * BEAT, grid, true)).toBeCloseTo(1);
    });

    it('decays through the beat', () => {
        const early = beatPulse(0.5 + 0.1 * BEAT, grid, true);
        const late = beatPulse(0.5 + 0.9 * BEAT, grid, true);
        expect(early).toBeCloseTo(Math.exp(-PULSE_DECAY * 0.1));
        expect(late).toBeLessThan(early);
        expect(late).toBeLessThan(0.01);
    });

    it('is 0 before the first beat, with the music off or without a grid', () => {
        expect(beatPulse(0.49, grid, true)).toBe(0);
        expect(beatPulse(0.5, grid, false)).toBe(0);
        expect(beatPulse(0.5, undefined, true)).toBe(0);
        expect(beatPulse(NaN, grid, true)).toBe(0);
    });

    it('has a grid for every track', () => {
        for (const track of SYNTHWAVE_TRACKS) {
            const g = TRACK_BEATS[track];
            expect(g.bpm).toBeGreaterThan(60);
            expect(g.firstBeat).toBeGreaterThanOrEqual(0);
            expect(g.firstBeat).toBeLessThan((BEATS_PER_BAR * 60) / g.bpm);
        }
    });
});
