import { describe, it, expect } from 'vitest';
import { sweepSteps, MAX_SWEEP_STEPS } from '../statSweep';

describe('sweepSteps', () => {
    it('walks the range in ascending integer steps', () => {
        expect(sweepSteps('speed', 100, 120, 5, 100).map((s) => s.value)).toEqual([
            100, 105, 110, 115, 120,
        ]);
    });

    it('marks exactly one step as the reference, at the resolved value', () => {
        const steps = sweepSteps('speed', 100, 120, 5, 110);
        expect(steps.filter((s) => s.isReference).map((s) => s.value)).toEqual([110]);
    });

    it('inserts the resolved value in order when the range excludes it', () => {
        const steps = sweepSteps('speed', 100, 120, 10, 93);
        expect(steps.map((s) => s.value)).toEqual([93, 100, 110, 120]);
        expect(steps[0].isReference).toBe(true);
    });

    it('inserts a resolved value that falls between two steps', () => {
        const steps = sweepSteps('speed', 100, 120, 10, 113);
        expect(steps.map((s) => s.value)).toEqual([100, 110, 113, 120]);
        expect(steps.find((s) => s.value === 113)?.isReference).toBe(true);
    });

    it('never emits a value below the stat floor', () => {
        // hp floors at 1: an actor built at 0 HP starts the fight on the engine's corpse path.
        expect(() => sweepSteps('hp', 0, 100, 50, 100)).toThrow(/floor|minimum/i);
    });

    it('allows 0 for a stat with no floor', () => {
        expect(sweepSteps('crit', 0, 20, 10, 10).map((s) => s.value)).toEqual([0, 10, 20]);
    });

    it('refuses a non-positive or non-finite step', () => {
        expect(() => sweepSteps('speed', 100, 120, 0, 100)).toThrow();
        expect(() => sweepSteps('speed', 100, 120, -5, 100)).toThrow();
        expect(() => sweepSteps('speed', 100, 120, NaN, 100)).toThrow();
    });

    it('refuses an inverted range', () => {
        expect(() => sweepSteps('speed', 120, 100, 5, 110)).toThrow();
    });

    it('refuses a range that would exceed the step cap', () => {
        expect(() => sweepSteps('speed', 0, 1000, 1, 100)).toThrow(
            new RegExp(String(MAX_SWEEP_STEPS))
        );
    });

    it('rejects an enormous range without iterating it', () => {
        // A number field is one keystroke from this. The cap must be computed, not discovered by
        // counting to it.
        const started = Date.now();
        expect(() => sweepSteps('speed', 0, 1_000_000_000, 1, 100)).toThrow();
        expect(Date.now() - started).toBeLessThan(100);
    });

    it('rounds fractional inputs to integers', () => {
        expect(sweepSteps('speed', 100.4, 110.6, 5.2, 100).map((s) => s.value)).toEqual([
            100, 105, 110,
        ]);
    });

    it('never emits a duplicate value when the resolved value is already a step', () => {
        const values = sweepSteps('speed', 100, 120, 10, 110).map((s) => s.value);
        expect(new Set(values).size).toBe(values.length);
    });
});
