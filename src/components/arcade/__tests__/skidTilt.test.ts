import { describe, expect, it } from 'vitest';
import { DUCK_SECONDS } from '../../../utils/arcade/constants';
import {
    CHATTER_ROLL,
    DRIFT_ROLL,
    driftSide,
    driftSwing,
    duckSkid,
    skidLean,
    skidRoll,
} from '../skidTilt';

describe('drift swing', () => {
    const at = (n: number) => Array.from({ length: n + 1 }, (_, i) => driftSwing(i / n));

    it('is level at both ends of the duck', () => {
        expect(driftSwing(0)).toBe(0);
        expect(driftSwing(1)).toBe(0);
        expect(driftSwing(0.95)).toBe(0);
    });

    it('kicks fully out early, holds, and eases back without swinging past', () => {
        const swing = at(200);
        expect(swing.indexOf(1) / 200).toBeLessThan(0.2);
        expect(driftSwing(0.3)).toBe(1);
        expect(Math.min(...swing)).toBe(0);
        const back = swing.slice(swing.lastIndexOf(1));
        for (let i = 1; i < back.length; i++) expect(back[i]).toBeLessThanOrEqual(back[i - 1]);
    });

    it('moves without jumps', () => {
        const swing = at(400);
        for (let i = 1; i < swing.length; i++) {
            expect(Math.abs(swing[i] - swing[i - 1])).toBeLessThan(0.05);
        }
    });
});

describe('drift side', () => {
    it('varies between ducks and holds through one', () => {
        const sides = new Set(Array.from({ length: 20 }, (_, i) => driftSide(i * 1.37)));
        expect(sides).toEqual(new Set([1, -1]));
        const t0 = 12.5;
        const side = driftSide(t0);
        // The duck's start reconstructed frame by frame stays one side.
        for (let f = 0; f < 45; f++) {
            const left = DUCK_SECONDS - f / 60;
            const swing = driftSwing(1 - left / DUCK_SECONDS);
            expect(duckSkid(left, t0 + f / 60)).toBeCloseTo(side * swing, 9);
        }
    });
});

describe('skid roll', () => {
    it('is level outside a duck', () => {
        expect(skidRoll(0, 1, 1, 0, 3.2, false)).toBe(0);
    });

    it('rolls onto the side the tail and the slide go', () => {
        expect(skidRoll(1, 1, 0, 0, 1, false)).toBeCloseTo(DRIFT_ROLL, 9);
        expect(skidRoll(1, 0, -1, 0, 1, false)).toBeCloseTo(-DRIFT_ROLL / 2, 9);
        expect(skidRoll(0.5, 1, 0, 0, 1, false)).toBeCloseTo(DRIFT_ROLL / 2, 9);
        expect(skidRoll(1, 1, 1, 0, 1, false)).toBeCloseTo(DRIFT_ROLL, 9);
    });

    it('chatters while scraping, within its amplitude, and varies over game time', () => {
        const rolls = Array.from({ length: 30 }, (_, i) => skidRoll(1, 0, 0, 1, i / 60, false));
        for (const r of rolls) expect(Math.abs(r)).toBeLessThanOrEqual(CHATTER_ROLL + 1e-9);
        expect(new Set(rolls.map((r) => r.toFixed(6))).size).toBeGreaterThan(10);
    });

    it('does not chatter under reduced motion or off the track', () => {
        expect(skidRoll(1, 0, 0, 1, 0.37, true)).toBe(0);
        expect(skidRoll(1, 0, 0, 0, 0.37, false)).toBe(0);
        expect(skidRoll(1, 0, 1, 1, 0.37, true)).toBeCloseTo(DRIFT_ROLL / 2, 9);
    });

    it('reads a full drift as a full lean', () => {
        expect(skidLean(DRIFT_ROLL)).toBe(1);
        expect(skidLean(-2 * DRIFT_ROLL)).toBe(-1);
        expect(skidLean(0)).toBe(0);
    });
});
