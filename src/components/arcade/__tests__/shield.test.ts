import { describe, expect, it } from 'vitest';
import { BUCKET_RATIO, bucketRadiusPx, fitShield, MIN_BUCKET_PX, shieldBucket } from '../shield';

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
