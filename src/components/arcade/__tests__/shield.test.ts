import { describe, expect, it } from 'vitest';
import { BUCKET_RATIO, bucketRadiusPx, MIN_BUCKET_PX, shieldBucket } from '../shield';

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
