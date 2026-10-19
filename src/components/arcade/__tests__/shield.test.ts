import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKET_RATIO, bucketRadiusPx, fitShield, MIN_BUCKET_PX, shieldBucket } from '../shield';
import { laneWidthAtPlayer, project } from '../projection';
import { sceneGeometry } from '../../theme/synthwaveScene';
import {
    DESPAWN_Z,
    JUMP_SCALE_GAIN,
    PICKUP_RADIUS,
    SPAWN_Z,
} from '../../../utils/arcade/constants';

describe('shield body buckets', () => {
    it('picks the smallest ladder step at or above the radius', () => {
        for (const r of [4.5, 10, 37.2, 120, 400, 1500]) {
            const b = shieldBucket(r);
            expect(bucketRadiusPx(b)).toBeGreaterThanOrEqual(r - 1e-9);
            expect(bucketRadiusPx(b - 1)).toBeLessThan(r);
        }
    });

    it('never magnifies a cached body by more than the ladder ratio', () => {
        for (let r = MIN_BUCKET_PX; r < 2000; r *= 1.037) {
            expect(bucketRadiusPx(shieldBucket(r)) / r).toBeLessThanOrEqual(BUCKET_RATIO + 1e-9);
        }
    });

    it('puts an exact ladder radius in its own bucket', () => {
        expect(shieldBucket(bucketRadiusPx(7))).toBe(7);
    });

    it('maps tiny, zero and invalid radii to the first bucket', () => {
        expect(shieldBucket(0)).toBe(0);
        expect(shieldBucket(2)).toBe(0);
        expect(shieldBucket(Number.NaN)).toBe(0);
    });
});

describe('fitShield', () => {
    const fit = (hw: number, hh: number) => {
        const p = { x: 0, y: 0, rx: 0, ry: 0, dpr: 1, bank: 0 };
        fitShield(p, hw, hh);
        return p;
    };

    it('hugs the ship with a little air on every side', () => {
        for (const [hw, hh] of [
            [20, 8],
            [35, 14],
            [10, 12],
        ]) {
            const { rx, ry } = fit(hw, hh);
            expect(rx).toBeGreaterThan(hw);
            expect(rx).toBeLessThan(hw * 1.5);
            expect(ry).toBeGreaterThan(hh);
        }
    });

    it('scales with the ship, so a narrow model gets a narrow field', () => {
        expect(fit(10, 5).rx * 2).toBeCloseTo(fit(20, 10).rx);
        expect(fit(10, 5).rx).toBeLessThan(fit(20, 5).rx);
    });

    it('is never flatter than two to one', () => {
        const { rx, ry } = fit(40, 2);
        expect(ry).toBeGreaterThanOrEqual(rx / 2);
    });
});

/** A 2D context that records the images drawn into it and ignores everything else. */
function recordingContext(drawn: unknown[]): CanvasRenderingContext2D {
    const gradient = { addColorStop() {} };
    return new Proxy(
        {},
        {
            get: (_t, key) => {
                if (key === 'drawImage') return (img: unknown) => drawn.push(img);
                if (key === 'createRadialGradient' || key === 'createLinearGradient') {
                    return () => gradient;
                }
                if (key === 'globalAlpha') return 1;
                return () => {};
            },
            set: () => true,
        }
    ) as unknown as CanvasRenderingContext2D;
}

describe('shield body cache', () => {
    let created: number;
    let drawn: unknown[];
    let ctx: CanvasRenderingContext2D;
    let S: typeof import('../shield');

    beforeEach(async () => {
        vi.resetModules();
        S = await import('../shield');
        created = 0;
        drawn = [];
        ctx = recordingContext(drawn);
        const make = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation(
            (tag: string, options?: ElementCreationOptions) => {
                if (tag === 'canvas') created++;
                return make(tag, options);
            }
        );
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
            return recordingContext([]);
        });
    });

    afterEach(() => vi.restoreAllMocks());

    /** Draws the ship's shield at device radius `r` and returns the body image it drew. */
    const shipBody = (r: number): unknown => {
        drawn.length = 0;
        S.drawShieldBack(ctx, { x: 0, y: 0, rx: r, ry: r / 2, dpr: 1, bank: 0 }, 0);
        return drawn[0];
    };

    it('keeps the ship body while a shield pickup flies the whole way past it', () => {
        const g = sceneGeometry(1280, 720);
        const atPlayerRow = PICKUP_RADIUS * 1.2 * laneWidthAtPlayer(g);
        const ship = 120;
        const body = shipBody(ship);
        const before = created;
        for (let z = SPAWN_Z; z >= DESPAWN_Z; z -= 0.25) {
            const r = PICKUP_RADIUS * 1.2 * project(g, 0, z).width;
            S.drawShieldPickup(ctx, 0, 0, r, atPlayerRow, 1);
            // The ship jumping meanwhile: its own few ladder steps.
            expect(shipBody(ship * (1 + JUMP_SCALE_GAIN * Math.abs(Math.sin(z))))).toBeTruthy();
        }
        expect(shipBody(ship)).toBe(body);
        const shipSteps = shieldBucket(ship * (1 + JUMP_SCALE_GAIN)) - shieldBucket(ship);
        // The pickup's one body, plus the ship's jump steps.
        expect(created - before).toBeLessThanOrEqual(1 + shipSteps);
    });

    it('keeps the ship jump span cached with room to spare', () => {
        const steps = shieldBucket(400 * (1 + JUMP_SCALE_GAIN)) - shieldBucket(400) + 1;
        expect(S.MAX_CACHED_BUCKETS).toBeGreaterThan(steps);
    });

    it('drops the least recently used body beyond its bound', () => {
        const radius = (i: number) => bucketRadiusPx(10 + i);
        const first = shipBody(radius(0));
        for (let i = 1; i < S.MAX_CACHED_BUCKETS; i++) shipBody(radius(i));
        // A hit refreshes the first body, so the next new size evicts the second.
        expect(shipBody(radius(0))).toBe(first);
        shipBody(radius(S.MAX_CACHED_BUCKETS));
        expect(shipBody(radius(0))).toBe(first);
        const before = created;
        shipBody(radius(1));
        expect(created).toBeGreaterThan(before);
    });

    it('never holds more bodies than its bound', () => {
        const bodies = new Set<unknown>();
        for (let i = 0; i < 3 * S.MAX_CACHED_BUCKETS; i++) bodies.add(shipBody(bucketRadiusPx(i)));
        const before = created;
        // The most recent bound's worth are all still cached.
        for (let i = 2 * S.MAX_CACHED_BUCKETS; i < 3 * S.MAX_CACHED_BUCKETS; i++) {
            shipBody(bucketRadiusPx(i));
        }
        expect(created).toBe(before);
        // An older one is rebuilt.
        shipBody(bucketRadiusPx(0));
        expect(created).toBeGreaterThan(before);
    });

    it('rebuilds the pickup body only when its size at the player row changes', () => {
        S.drawShieldPickup(ctx, 0, 0, 5, 40, 1);
        const before = created;
        for (let r = 1; r < 200; r += 3) S.drawShieldPickup(ctx, 0, 0, r, 40, 1);
        expect(created).toBe(before);
        S.drawShieldPickup(ctx, 0, 0, 5, 80, 1);
        expect(created).toBeGreaterThan(before);
    });
});
