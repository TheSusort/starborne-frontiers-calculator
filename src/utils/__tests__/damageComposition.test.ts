import { describe, it, expect } from 'vitest';
import { composeIncomingFactor, expectedIncomingFactor } from '../damageComposition';

describe('expectedIncomingFactor', () => {
    it('is the plain buff channel when there is no crit reduction', () => {
        expect(expectedIncomingFactor(-20, 0, 100)).toBeCloseTo(0.8, 12);
        expect(expectedIncomingFactor(0, 0, 50)).toBe(1);
    });

    it('at a 100% crit rate applies the crit reduction in full', () => {
        expect(expectedIncomingFactor(0, 35, 100)).toBeCloseTo(0.65, 12);
    });

    it('at a 50% crit rate averages the non-crit and crit hit', () => {
        expect(expectedIncomingFactor(0, 40, 50)).toBeCloseTo(0.5 * 1 + 0.5 * 0.6, 12);
    });

    it('at a 0% crit rate ignores the crit reduction', () => {
        expect(expectedIncomingFactor(-10, 40, 0)).toBeCloseTo(0.9, 12);
    });

    it('floors each branch at the 70% non-defence cap', () => {
        expect(expectedIncomingFactor(-85, 40, 100)).toBeCloseTo(0.3, 12);
        expect(expectedIncomingFactor(-85, 0, 100)).toBeCloseTo(0.3, 12);
        // The floor binds on the product: 0.5 * 0.4 = 0.2 -> 0.3.
        expect(expectedIncomingFactor(-50, 60, 100)).toBeCloseTo(0.3, 12);
    });

    it('matches composeIncomingFactor on the crit branch', () => {
        expect(expectedIncomingFactor(-20, 35, 100)).toBe(
            composeIncomingFactor(-20, { passivePct: 0, separatePcts: [35] })
        );
    });
});
