import { describe, expect, it } from 'vitest';
import {
    composeDotReductionFactor,
    composeIncomingFactor,
    mergeIncomingReductionParts,
    NO_INCOMING_REDUCTION,
} from '../victimDamage';

const parts = (passivePct: number, separatePcts: number[] = []) => ({ passivePct, separatePcts });

// Each case is an in-game B/A ratio measured 2026-10-12 (#672). Every case also asserts the
// ratio a WRONG composition would give, so the test fails if buckets are merged.
describe('composeIncomingFactor — measured game ratios (#672)', () => {
    it('buffs sum with each other: Warding −20, ± Inc. Damage Down II', () => {
        const r = composeIncomingFactor(-50) / composeIncomingFactor(-20);
        expect(r).toBeCloseTo(0.625, 6);
    });
    it('a ship passive multiplies against the buff sum (Iridium 35, ± IDD II)', () => {
        const r = composeIncomingFactor(-30, parts(35)) / composeIncomingFactor(0, parts(35));
        expect(r).toBeCloseTo(0.7, 6);
        expect(r).not.toBeCloseTo(0.35 / 0.65, 3); // summed would be 0.538
    });
    it('Hardened is its own factor, not in the buff sum', () => {
        const r =
            composeIncomingFactor(-50, parts(0, [15])) / composeIncomingFactor(-20, parts(0, [15]));
        expect(r).toBeCloseTo(0.625, 6);
    });
    it('ship passives ADD with each other (Wusheng 25 + Fuying aura 10)', () => {
        const r = composeIncomingFactor(0, parts(35)) / composeIncomingFactor(0, parts(25));
        expect(r).toBeCloseTo(0.65 / 0.75, 6);
        expect(r).not.toBeCloseTo(0.9, 3); // multiplied would be 0.900
    });
    it('an implant is its own factor, not in the passive sum (Voidshade 20 on Wusheng 25)', () => {
        const r = composeIncomingFactor(0, parts(25, [20])) / composeIncomingFactor(0, parts(25));
        expect(r).toBeCloseTo(0.8, 6);
    });
    it('a squad-leader reduction is its own factor (Overseer III 5 on Iridium 35)', () => {
        const r = composeIncomingFactor(0, parts(35, [5])) / composeIncomingFactor(0, parts(35));
        expect(r).toBeCloseTo(0.95, 6);
    });
    it('caps the whole product at a 70% reduction', () => {
        // Warding −20 + IDD III −45 = −65 → 0.35, × Hardened 0.85 = 0.2975 → floored to 0.30.
        expect(composeIncomingFactor(-65, parts(0, [15]))).toBe(1 - 70 / 100);
        expect(composeIncomingFactor(-65)).toBeCloseTo(0.35, 12);
    });
    it('is byte-identical to the old additive form for a buff-only victim', () => {
        for (const c of [-69, -45.5, -20, 0, 12.5, 30]) {
            expect(composeIncomingFactor(c)).toBe(1 + c / 100);
        }
        expect(composeIncomingFactor(-90)).toBe(1 + -70 / 100);
    });
    it('Hardened crit vs normal hit at crit power 64 is 1.394', () => {
        const normal = composeIncomingFactor(-20);
        const crit = 1.64 * composeIncomingFactor(-20, parts(0, [15]));
        expect(crit / normal).toBeCloseTo(1.394, 6);
    });
    it('defaults to no reduction', () => {
        expect(composeIncomingFactor(-20, NO_INCOMING_REDUCTION)).toBe(composeIncomingFactor(-20));
    });
    it('never goes negative when passives exceed 100', () => {
        expect(composeIncomingFactor(50, parts(140))).toBe(1 - 70 / 100);
    });
});

describe('mergeIncomingReductionParts', () => {
    it('adds passives and concatenates separate factors', () => {
        expect(mergeIncomingReductionParts(parts(25, [20]), parts(10, [5]))).toEqual(
            parts(35, [20, 5])
        );
    });
});

describe('composeDotReductionFactor', () => {
    it('Voron 20% DoT passive under Inc. DoT Up III ticks 1.04× an unreduced neighbour', () => {
        // The tick already carries (1 + 30/100); the reduction multiplies it.
        const voron = 1.3 * composeDotReductionFactor(parts(20));
        const neighbour = 1.3 * composeDotReductionFactor(NO_INCOMING_REDUCTION);
        expect(voron / 1.0 / (neighbour / 1.3)).toBeCloseTo(1.04, 6);
        expect(voron / neighbour).toBeCloseTo(0.8, 6);
    });
    it('passives sum, separate factors multiply, no cap', () => {
        expect(composeDotReductionFactor(parts(20, [30]))).toBeCloseTo(0.8 * 0.7, 12);
        expect(composeDotReductionFactor(parts(50, [50]))).toBeCloseTo(0.25, 12);
    });
    it('is exactly 1 with nothing applying', () => {
        expect(composeDotReductionFactor(NO_INCOMING_REDUCTION)).toBe(1);
    });
});
