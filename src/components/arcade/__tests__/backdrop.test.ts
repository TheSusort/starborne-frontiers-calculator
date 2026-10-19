import { describe, expect, it } from 'vitest';
import { backdropRows } from '../backdrop';
import { drawGround, drawMountains, mountainsTop, sceneGeometry } from '../../theme/synthwaveScene';

/** A context that records the highest (smallest) y any path point or rectangle reaches. */
function topRecorder() {
    let top = Infinity;
    const y = (v: number) => (top = Math.min(top, v));
    const ctx = {
        beginPath() {},
        closePath() {},
        fill() {},
        moveTo: (_x: number, v: number) => y(v),
        lineTo: (_x: number, v: number) => y(v),
        fillRect: (_x: number, v: number) => y(v),
        createLinearGradient: () => ({ addColorStop() {} }),
        fillStyle: '',
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, top: () => top };
}

describe('backdrop', () => {
    it('caches the ground layer from at or above everything the mountains and ground draw', () => {
        for (const [w, h] of [
            [1280, 720],
            [390, 844],
            [2560, 1080],
        ]) {
            const g = sceneGeometry(w, h);
            const rec = topRecorder();
            drawMountains(rec.ctx, g);
            drawGround(rec.ctx, g);
            expect(mountainsTop(g)).toBeLessThanOrEqual(rec.top());
            expect(mountainsTop(g)).toBeGreaterThan(rec.top() - 1);
        }
    });

    it('covers every device row between the two layers', () => {
        for (const dpr of [1, 1.5, 2, 3]) {
            const g = sceneGeometry(1013, 677);
            const { sky, ground, fan } = backdropRows(g, dpr);
            expect(fan[0]).toBeLessThan(g.horizonY * dpr);
            expect(fan[1]).toBe(Math.round(g.h * dpr));
            expect(sky[0]).toBe(0);
            expect(ground[1]).toBe(Math.round(g.h * dpr));
            expect(ground[0]).toBeLessThan(sky[1]);
            expect(sky[1]).toBeGreaterThan(g.horizonY * dpr);
        }
    });
});
