import { describe, it, expect } from 'vitest';
import { clampRunCount, clampSeed, MAX_RUN_COUNT, MIN_RUN_COUNT } from '../seedRunInputs';

describe('clampRunCount', () => {
    it('passes through an in-range integer unchanged', () => {
        expect(clampRunCount(20)).toBe(20);
    });

    it('clamps a value above the ceiling to MAX_RUN_COUNT', () => {
        expect(clampRunCount(5000)).toBe(MAX_RUN_COUNT);
    });

    it('clamps a cleared field (Number("") === 0) up to MIN_RUN_COUNT rather than throwing downstream', () => {
        expect(clampRunCount(0)).toBe(MIN_RUN_COUNT);
    });

    it('clamps a negative value up to MIN_RUN_COUNT', () => {
        expect(clampRunCount(-10)).toBe(MIN_RUN_COUNT);
    });

    it('rounds a fractional value', () => {
        expect(clampRunCount(4.6)).toBe(5);
    });

    it('falls back to MIN_RUN_COUNT for NaN/Infinity', () => {
        expect(clampRunCount(NaN)).toBe(MIN_RUN_COUNT);
        expect(clampRunCount(Infinity)).toBe(MIN_RUN_COUNT);
    });
});

describe('clampSeed', () => {
    it('passes through an in-range integer unchanged', () => {
        expect(clampSeed(12345)).toBe(12345);
    });

    it('rounds a fractional value', () => {
        expect(clampSeed(12.6)).toBe(13);
    });

    it('clamps a negative value up to 0', () => {
        expect(clampSeed(-5)).toBe(0);
    });

    it('clamps a value above the safe 32-bit range', () => {
        expect(clampSeed(2 ** 40)).toBe(2 ** 31 - 1);
    });

    it('falls back to 0 for NaN/Infinity (0 is not a degenerate mulberry32 seed)', () => {
        expect(clampSeed(NaN)).toBe(0);
        expect(clampSeed(Infinity)).toBe(0);
    });
});
