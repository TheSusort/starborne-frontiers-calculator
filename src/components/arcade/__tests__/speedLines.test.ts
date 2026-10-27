import { describe, expect, it } from 'vitest';
import {
    activeSpeedLines,
    advanceSpeedLines,
    BLUR_EXTRA_LINES,
    blurStrength,
    createSpeedLines,
    laneWedge,
    MAX_ACTIVE_LINES,
    MAX_STREAK,
    MIN_ACTIVE_LINES,
    MIN_STREAK,
    SPEED_LINE_POOL,
    streakLength,
} from '../speedLines';
import { MAX_SPEED, START_SPEED } from '../../../utils/arcade/constants';
import { sceneGeometry } from '../../theme/synthwaveScene';

/** A deterministic stand-in for Math.random. */
function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

/** Angle of a line from straight down the screen. */
const angleFromDown = (dx: number, dy: number) => Math.atan2(Math.abs(dx), dy);

describe('speed lines', () => {
    it('scales density and streak length with speed, clamped to the speed range', () => {
        expect(activeSpeedLines(START_SPEED)).toBe(MIN_ACTIVE_LINES);
        expect(activeSpeedLines(MAX_SPEED)).toBe(MAX_ACTIVE_LINES);
        expect(activeSpeedLines(0)).toBe(MIN_ACTIVE_LINES);
        expect(activeSpeedLines(MAX_SPEED * 2)).toBe(MAX_ACTIVE_LINES);
        const mid = activeSpeedLines((START_SPEED + MAX_SPEED) / 2);
        expect(mid).toBeGreaterThan(MIN_ACTIVE_LINES);
        expect(mid).toBeLessThan(MAX_ACTIVE_LINES);
        expect(streakLength(START_SPEED)).toBeCloseTo(MIN_STREAK);
        expect(streakLength(MAX_SPEED)).toBeCloseTo(MAX_STREAK);
        expect(MAX_ACTIVE_LINES).toBeLessThanOrEqual(SPEED_LINE_POOL);
    });

    it('starts the speed blur at 60% of the speed range and peaks at MAX_SPEED', () => {
        const at = (share: number) => START_SPEED + (MAX_SPEED - START_SPEED) * share;
        expect(blurStrength(at(0))).toBe(0);
        expect(blurStrength(at(0.6))).toBeCloseTo(0);
        expect(blurStrength(at(0.8))).toBeCloseTo(0.5);
        expect(blurStrength(at(1))).toBeCloseTo(1);
        expect(blurStrength(MAX_SPEED * 2)).toBe(1);
        expect(MAX_ACTIVE_LINES + BLUR_EXTRA_LINES).toBeLessThanOrEqual(SPEED_LINE_POOL);
    });

    it('holds still without travel', () => {
        const pool = createSpeedLines(0.5, lcg(1));
        const before = pool.map((l) => ({ ...l }));
        advanceSpeedLines(pool, 0, 0.5, lcg(2));
        expect(pool).toEqual(before);
    });

    it('moves lines outward with travel, faster the farther they are', () => {
        const pool = createSpeedLines(0.5, lcg(3));
        for (const l of pool) {
            l.dist = 0.2;
            l.rate = 1;
        }
        pool[1].dist = 0.4;
        advanceSpeedLines(pool, 1, 0.5, lcg(4));
        const near = pool[0].dist - 0.2;
        const far = pool[1].dist - 0.4;
        expect(near).toBeGreaterThan(0);
        expect(far).toBeGreaterThan(near);
    });

    it('mutates the pool in place and respawns lines past the edge near the centre', () => {
        const pool = createSpeedLines(0.5, lcg(5));
        const objects = [...pool];
        pool[0].dist = 0.999;
        advanceSpeedLines(pool, 5, 0.5, lcg(6));
        expect(pool).toHaveLength(SPEED_LINE_POOL);
        pool.forEach((l, i) => expect(l).toBe(objects[i]));
        expect(pool[0].dist).toBeLessThan(0.5);
        for (const l of pool) expect(l.dist).toBeLessThanOrEqual(1);
    });

    it('never spawns a line inside the lane wedge', () => {
        const wedge = 0.9;
        const random = lcg(7);
        const pool = createSpeedLines(wedge, random);
        for (let i = 0; i < 400; i++) advanceSpeedLines(pool, 3, wedge, random);
        for (const l of pool) {
            expect(Math.hypot(l.dx, l.dy)).toBeCloseTo(1);
            expect(angleFromDown(l.dx, l.dy)).toBeGreaterThanOrEqual(wedge - 1e-9);
        }
    });

    it('widens the lane wedge on a wide screen and narrows it on a tall one', () => {
        const wide = laneWedge(sceneGeometry(1600, 900));
        const tall = laneWedge(sceneGeometry(400, 800));
        expect(wide).toBeGreaterThan(tall);
        expect(tall).toBeGreaterThan(0);
        expect(wide).toBeLessThan(Math.PI / 2);
    });
});
