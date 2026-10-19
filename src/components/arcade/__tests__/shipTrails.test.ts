import { describe, expect, it } from 'vitest';
import {
    createShipTrail,
    MAX_TRAIL_SECONDS,
    MIN_TRAIL_SECONDS,
    pointAge,
    recordTrail,
    sampleIndex,
    TRAIL_SAMPLE_SECONDS,
    TRAIL_SAMPLES,
    trailSeconds,
} from '../shipTrails';
import { MAX_SPEED, START_SPEED } from '../../../utils/arcade/constants';

const STEP = TRAIL_SAMPLE_SECONDS;
const newest = (t: ReturnType<typeof createShipTrail>, age: number) => t.laneX[sampleIndex(t, age)];

describe('ship trail ring buffer', () => {
    it('writes a sample per sample period of game time, newest first', () => {
        const t = createShipTrail();
        for (let i = 0; i < 5; i++) recordTrail(t, STEP, i, 0.25, 0);
        expect(t.count).toBe(5);
        expect([0, 1, 2, 3, 4].map((a) => newest(t, a))).toEqual([4, 3, 2, 1, 0]);
    });

    it('gathers short frames until a period has passed', () => {
        const t = createShipTrail();
        recordTrail(t, STEP, 0, 0, 0);
        recordTrail(t, STEP / 3, 1, 0, 0);
        recordTrail(t, STEP / 3, 2, 0, 0);
        expect(t.count).toBe(1);
        expect(t.sinceSample).toBeCloseTo((2 * STEP) / 3);
        recordTrail(t, STEP / 2, 3, 0, 0);
        expect(t.count).toBe(2);
        expect(newest(t, 0)).toBe(3);
        expect(t.sinceSample).toBeCloseTo(STEP / 6);
    });

    it('records nothing while the game does not step', () => {
        const t = createShipTrail();
        recordTrail(t, STEP, 1, 0, 0);
        const before = { ...t, laneX: t.laneX.slice() };
        for (let i = 0; i < 100; i++) recordTrail(t, 0, 9, 9, 9);
        expect(t.count).toBe(before.count);
        expect(t.head).toBe(before.head);
        expect(t.sinceSample).toBe(before.sinceSample);
        expect(Array.from(t.laneX)).toEqual(Array.from(before.laneX));
    });

    it('writes one sample, not a burst, after a long gap', () => {
        const t = createShipTrail();
        recordTrail(t, STEP, 0, 0, 0);
        recordTrail(t, 10 * STEP, 1, 0, 0);
        expect(t.count).toBe(2);
        expect(t.sinceSample).toBeLessThan(STEP);
    });

    it('wraps in place, keeping the newest TRAIL_SAMPLES and the same arrays', () => {
        const t = createShipTrail();
        const arrays = [t.laneX, t.lift, t.bank];
        const total = TRAIL_SAMPLES * 2 + 3;
        for (let i = 0; i < total; i++) recordTrail(t, STEP, i, i / 10, -i);
        expect(t.count).toBe(TRAIL_SAMPLES);
        expect(arrays.every((a, k) => a === [t.laneX, t.lift, t.bank][k])).toBe(true);
        for (let age = 0; age < TRAIL_SAMPLES; age++) {
            const i = sampleIndex(t, age);
            expect(t.laneX[i]).toBe(total - 1 - age);
            expect(t.lift[i]).toBeCloseTo((total - 1 - age) / 10);
            expect(t.bank[i]).toBe(-(total - 1 - age));
        }
    });

    it('ages points from the live ship through the samples', () => {
        const t = createShipTrail();
        recordTrail(t, STEP, 0, 0, 0);
        recordTrail(t, STEP * 1.5, 0, 0, 0);
        expect(pointAge(t, 0)).toBe(0);
        expect(pointAge(t, 1)).toBeCloseTo(STEP / 2);
        expect(pointAge(t, 2)).toBeCloseTo(STEP * 1.5);
    });

    it('lengthens with speed, clamped to the speed range', () => {
        expect(trailSeconds(START_SPEED)).toBeCloseTo(MIN_TRAIL_SECONDS);
        expect(trailSeconds(MAX_SPEED)).toBeCloseTo(MAX_TRAIL_SECONDS);
        expect(trailSeconds(0)).toBeCloseTo(MIN_TRAIL_SECONDS);
        expect(trailSeconds(MAX_SPEED * 2)).toBeCloseTo(MAX_TRAIL_SECONDS);
        expect(MAX_TRAIL_SECONDS / STEP).toBeLessThan(TRAIL_SAMPLES);
    });
});
