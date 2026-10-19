import { afterEach, describe, expect, it, vi } from 'vitest';
import { backdropRows, createBackdrop, drawBackdropGlow, drawBackdropSky } from '../backdrop';
import {
    drawGround,
    drawMountains,
    drawSunGlow,
    mountainsTop,
    sceneGeometry,
    sunGlowBottom,
} from '../../theme/synthwaveScene';

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

    it('caches the sun glow from the top down to everything it draws', () => {
        for (const [w, h] of [
            [1280, 720],
            [390, 844],
            [2560, 1080],
        ]) {
            const g = sceneGeometry(w, h);
            let bottom = -Infinity;
            const ctx = {
                fillRect: (_x: number, y: number, _w: number, rh: number) =>
                    (bottom = Math.max(bottom, y + rh)),
                createRadialGradient: () => ({ addColorStop() {} }),
                fillStyle: '',
            } as unknown as CanvasRenderingContext2D;
            drawSunGlow(ctx, g);
            expect(sunGlowBottom(g)).toBeGreaterThanOrEqual(bottom);
            for (const dpr of [1, 1.5, 2]) {
                const { glow } = backdropRows(g, dpr);
                expect(glow[0]).toBe(0);
                const { sky } = backdropRows(g, dpr);
                // The ground covers everything below the sky layer, so the glow stops there.
                expect(glow[1]).toBeGreaterThanOrEqual(Math.min(h, bottom, g.horizonY) * dpr);
                expect(glow[1]).toBeLessThanOrEqual(sky[1]);
                expect(glow[1]).toBeLessThanOrEqual(Math.round(h * dpr));
            }
        }
    });

    describe('layers', () => {
        afterEach(() => vi.restoreAllMocks());

        /** A context that records the outer radius of every radial gradient made through it. */
        function radialRecorder(radii: number[]): CanvasRenderingContext2D {
            const gradient = { addColorStop() {} };
            return new Proxy(
                {},
                {
                    get: (_t, key) =>
                        key === 'createRadialGradient'
                            ? (...a: number[]) => {
                                  radii.push(a[5]);
                                  return gradient;
                              }
                            : key === 'createLinearGradient'
                              ? () => gradient
                              : () => {},
                    set: () => true,
                }
            ) as unknown as CanvasRenderingContext2D;
        }

        /** Blits one layer, its cache drawn through a recorder, and returns its radial radii. */
        function layerRadials(blit: typeof drawBackdropSky): number[] {
            const radii: number[] = [];
            vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
                radialRecorder(radii)
            );
            const main = { drawImage() {} } as unknown as CanvasRenderingContext2D;
            blit(main, sceneGeometry(1280, 720), createBackdrop(), 1);
            return radii;
        }

        it('keeps the sun glow out of the sky layer, so stars draw under it', () => {
            const glow: number[] = [];
            drawSunGlow(radialRecorder(glow), sceneGeometry(1280, 720));
            expect(glow).toHaveLength(1);
            expect(layerRadials(drawBackdropSky)).not.toContain(glow[0]);
            expect(layerRadials(drawBackdropGlow)).toEqual(glow);
        });
    });
});
