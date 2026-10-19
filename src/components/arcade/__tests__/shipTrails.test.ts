import { describe, expect, it } from 'vitest';
import {
    advanceTrail,
    createShipTrail,
    drawShipTrails,
    LAG_MAX_AGE,
    LAG_POINTS,
    lagTau,
    streakLength,
    streakPairs,
    SUB,
    trailLaneX,
} from '../shipTrails';
import { MAX_SPEED, START_SPEED } from '../../../utils/arcade/constants';
import { sceneGeometry } from '../../theme/synthwaveScene';
import { project } from '../projection';

const FRAME = 1 / 60;

describe('ship trail lag buffer', () => {
    it('places every point on the ship on its first advance, even with no time', () => {
        const t = createShipTrail();
        advanceTrail(t, 0, 0.7);
        expect(t.primed).toBe(true);
        expect(Array.from(t.lag).every((x) => x === 0.7)).toBe(true);
    });

    it('holds still while the game does not step', () => {
        const t = createShipTrail();
        advanceTrail(t, FRAME, 0);
        advanceTrail(t, FRAME, 1);
        const before = Array.from(t.lag);
        const clock = t.clock;
        for (let i = 0; i < 100; i++) advanceTrail(t, 0, -1);
        expect(Array.from(t.lag)).toEqual(before);
        expect(t.clock).toBe(clock);
    });

    it('follows a lane change with the head first and the tail last', () => {
        const t = createShipTrail();
        advanceTrail(t, FRAME, 0);
        for (let i = 0; i < 6; i++) advanceTrail(t, FRAME, 1);
        const head = trailLaneX(t, 0);
        const mid = trailLaneX(t, LAG_MAX_AGE / 2);
        const tail = trailLaneX(t, LAG_MAX_AGE);
        expect(head).toBeGreaterThan(0.9);
        expect(head).toBeGreaterThan(mid);
        expect(mid).toBeGreaterThan(tail);
        expect(tail).toBeGreaterThan(0);
        // Every point keeps moving monotonically from the old lane toward the new one.
        for (let k = 1; k < LAG_POINTS; k++) expect(t.lag[k]).toBeLessThanOrEqual(t.lag[k - 1]);
    });

    it('settles on the ship once it stops sliding', () => {
        const t = createShipTrail();
        advanceTrail(t, FRAME, -1);
        for (let i = 0; i < 600; i++) advanceTrail(t, FRAME, 0);
        for (const x of t.lag) expect(Math.abs(x)).toBeLessThan(1e-3);
    });

    it('does not depend on how game time is split into frames', () => {
        const a = createShipTrail();
        const b = createShipTrail();
        advanceTrail(a, 0, 0);
        advanceTrail(b, 0, 0);
        advanceTrail(a, 0.1, 1);
        for (let i = 0; i < 10; i++) advanceTrail(b, 0.01, 1);
        for (let k = 0; k < LAG_POINTS; k++) expect(a.lag[k]).toBeCloseTo(b.lag[k], 12);
        expect(a.clock).toBeCloseTo(b.clock);
    });

    it('interpolates between points and holds the oldest past the end', () => {
        const t = createShipTrail();
        t.primed = true;
        t.lag.forEach((_, k) => (t.lag[k] = k));
        const step = LAG_MAX_AGE / (LAG_POINTS - 1);
        expect(trailLaneX(t, 0)).toBe(0);
        expect(trailLaneX(t, 2.5 * step)).toBeCloseTo(2.5);
        expect(trailLaneX(t, LAG_MAX_AGE * 3)).toBe(LAG_POINTS - 1);
        expect(trailLaneX(t, -1)).toBe(0);
    });

    it('keeps its buffer in place', () => {
        const t = createShipTrail();
        const lag = t.lag;
        for (let i = 0; i < 200; i++) advanceTrail(t, FRAME, i % 3);
        expect(t.lag).toBe(lag);
        expect(t.lag.length).toBe(LAG_POINTS);
    });

    it('lags more the older a point is', () => {
        expect(lagTau(0)).toBeLessThan(lagTau(0.3));
        expect(lagTau(0.3)).toBeLessThan(lagTau(LAG_MAX_AGE));
    });
});

describe('air-flow streaks', () => {
    it('grow in count and length with speed', () => {
        expect(streakPairs(START_SPEED)).toBe(1);
        expect(streakPairs(MAX_SPEED)).toBe(3);
        expect(streakPairs((START_SPEED + MAX_SPEED) / 2)).toBe(2);
        expect(streakLength(START_SPEED)).toBeLessThan(streakLength(MAX_SPEED));
        expect(streakLength(MAX_SPEED * 2)).toBe(streakLength(MAX_SPEED));
    });
});

describe('trail track rows', () => {
    it('rely on screen x being affine in the lane offset at a fixed depth', () => {
        for (const [w, h] of [
            [1280, 720],
            [390, 844],
        ]) {
            const g = sceneGeometry(w, h);
            for (const z of [-2.3, -1, -0.05, 0, 3]) {
                const centre = project(g, 0, z);
                for (const laneX of [-1.4, -0.33, 0.5, 1.2]) {
                    const p = project(g, laneX, z);
                    expect(p.x).toBeCloseTo(centre.x + laneX * centre.width, 6);
                    expect(p.y).toBeCloseTo(centre.y, 9);
                    expect(p.width).toBeCloseTo(centre.width, 6);
                }
            }
        }
    });
});

describe('drawShipTrails', () => {
    /** Draws a sliding ship's trails at top speed into a recorder; returns every number handed
     *  to `moveTo`, `lineTo` and `lineWidth`, the scale they were drawn under, and the
     *  transform's state afterwards. */
    function record() {
        const numbers: number[] = [];
        const scales: number[] = [];
        let scale = 1;
        const ctx = {
            globalAlpha: 1,
            lineCap: 'butt',
            globalCompositeOperation: 'source-over',
            strokeStyle: '',
            set lineWidth(v: number) {
                numbers.push(v);
                scales.push(scale);
            },
            scale: (x: number) => (scale *= x),
            beginPath() {},
            stroke() {},
            moveTo: (x: number, y: number) => numbers.push(x, y) && scales.push(scale),
            lineTo: (x: number, y: number) => numbers.push(x, y) && scales.push(scale),
        } as unknown as CanvasRenderingContext2D;
        const g = sceneGeometry(1280, 720);
        const trail = createShipTrail();
        for (let i = 0; i < 30; i++) advanceTrail(trail, FRAME, i / 30);
        const box = { x: 640, y: 600, halfWidth: 60, top: -20, bottom: 15, baseX: 640, baseY: 680 };
        drawShipTrails(ctx, g, trail, MAX_SPEED, 1, box, 300, 1);
        return { numbers, scales, after: scale, ctx };
    }

    it('hands the canvas whole numbers of 1/SUB px, so no call boxes a fraction', () => {
        const { numbers, scales } = record();
        expect(numbers.length).toBeGreaterThan(100);
        expect(numbers.every(Number.isInteger)).toBe(true);
        expect(scales.every((s) => s === 1 / SUB)).toBe(true);
        // Points are px × SUB, not px: on screen once scaled back.
        expect(Math.max(...numbers) / SUB).toBeLessThan(2 * 1280);
        expect(Math.max(...numbers)).toBeGreaterThan(100 * SUB);
    });

    it('leaves the transform and drawing state as it found them', () => {
        const { after, ctx } = record();
        expect(after).toBe(1);
        expect(ctx.globalAlpha).toBe(1);
        expect(ctx.lineCap).toBe('butt');
        expect(ctx.globalCompositeOperation).toBe('source-over');
    });
});
