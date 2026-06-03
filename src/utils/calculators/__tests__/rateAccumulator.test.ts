import { describe, it, expect } from 'vitest';
import { makeRateGate } from '../rateAccumulator';

const fires = (rate: number, calls: number): boolean[] => {
    const gate = makeRateGate();
    return Array.from({ length: calls }, () => gate(rate));
};

describe('makeRateGate', () => {
    it('rate 1 fires on every call', () => {
        expect(fires(1, 5)).toEqual([true, true, true, true, true]);
    });

    it('rate 0 never fires', () => {
        expect(fires(0, 5)).toEqual([false, false, false, false, false]);
    });

    it('rate 0.999 over 1000 calls fires exactly 999 times (EPS sanity)', () => {
        expect(fires(0.999, 1000).filter(Boolean)).toHaveLength(999);
    });

    it('rate 0.7 over 10 calls fires exactly 7 times, max gap 2', () => {
        const result = fires(0.7, 10);
        expect(result.filter(Boolean)).toHaveLength(7);
        // No stretch of 2+ consecutive misses at 70%
        for (let i = 0; i < result.length - 1; i++) {
            expect(result[i] || result[i + 1]).toBe(true);
        }
    });

    it('rate 0.5 alternates starting on the second call', () => {
        expect(fires(0.5, 6)).toEqual([false, true, false, true, false, true]);
    });

    it('rate 0.1 over 10 calls fires exactly once (float drift)', () => {
        expect(fires(0.1, 10).filter(Boolean)).toHaveLength(1);
    });

    it('back-loads the first fire: rate 0.2 first fires on call 5', () => {
        expect(fires(0.2, 5)).toEqual([false, false, false, false, true]);
    });

    it('clamps rates outside [0, 1]', () => {
        expect(fires(1.5, 3)).toEqual([true, true, true]);
        expect(fires(-0.5, 3)).toEqual([false, false, false]);
    });

    it('handles a varying rate per call', () => {
        const gate = makeRateGate();
        expect(gate(0.5)).toBe(false); // acc 0.5
        expect(gate(0.6)).toBe(true); // acc 1.1 → fire, 0.1
        expect(gate(0.5)).toBe(false); // acc 0.6
        expect(gate(0.5)).toBe(true); // acc 1.1 → fire
    });
});
