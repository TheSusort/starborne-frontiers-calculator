import { describe, expect, it } from 'vitest';
import {
    NEAR_MISS_LABEL_SECONDS,
    nearMissLabelStyle,
    pruneNearMissLabels,
} from '../nearMissLabels';

describe('nearMissLabelStyle', () => {
    it('rises and fades over its life, then is gone', () => {
        const start = nearMissLabelStyle(0, false);
        const late = nearMissLabelStyle(NEAR_MISS_LABEL_SECONDS * 0.9, false);
        expect(start).toEqual({ alpha: 1, rise: 0 });
        expect(late!.alpha).toBeLessThan(0.3);
        expect(late!.rise).toBeGreaterThan(0);
        expect(nearMissLabelStyle(NEAR_MISS_LABEL_SECONDS, false)).toBeNull();
    });

    it('fades without rising under reduced motion', () => {
        for (let t = 0; t < NEAR_MISS_LABEL_SECONDS; t += 0.05) {
            expect(nearMissLabelStyle(t, true)!.rise).toBe(0);
            expect(nearMissLabelStyle(t, true)!.alpha).toBe(nearMissLabelStyle(t, false)!.alpha);
        }
        expect(nearMissLabelStyle(NEAR_MISS_LABEL_SECONDS * 0.9, true)!.alpha).toBeLessThan(0.3);
    });
});

describe('pruneNearMissLabels', () => {
    it('keeps only the labels still showing, in order', () => {
        const labels = [
            { points: 25, at: 0 },
            { points: 50, at: 1 },
            { points: 75, at: 1.5 },
        ];
        pruneNearMissLabels(labels, 1 + NEAR_MISS_LABEL_SECONDS / 2);
        expect(labels.map((l) => l.points)).toEqual([50, 75]);
    });
});
