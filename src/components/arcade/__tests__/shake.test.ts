import { describe, expect, it } from 'vitest';
import { SHAKE_AMPLITUDE, SHAKE_ATTACK_SECONDS, SHAKE_SECONDS, shakeOffset } from '../shake';
import { SHIELD_BREAK_FLASH } from '../../../utils/arcade/constants';

const H = 720;
const out = { x: 0, y: 0, amplitude: 0 };
/** The shake `elapsed` seconds after the shield broke. */
const after = (elapsed: number, reduced = false) =>
    shakeOffset(out, SHIELD_BREAK_FLASH - elapsed, H, reduced);

describe('shakeOffset', () => {
    it('starts as the game steps past a shield break, near full amplitude', () => {
        // Still while the game has not stepped since the break (a duel's countdown).
        expect(after(0)).toBe(0);
        const left = 1 - SHAKE_ATTACK_SECONDS / SHAKE_SECONDS;
        expect(after(SHAKE_ATTACK_SECONDS)).toBeCloseTo(SHAKE_AMPLITUDE * H * left * left);
        expect(Math.hypot(out.x, out.y)).toBeGreaterThan(0);
    });

    it('stays within its amplitude and decays to 0 by SHAKE_SECONDS', () => {
        let previous = Infinity;
        for (let t = SHAKE_ATTACK_SECONDS; t < SHAKE_SECONDS; t += 0.01) {
            const amplitude = after(t);
            expect(amplitude).toBeLessThan(previous);
            expect(Math.abs(out.x)).toBeLessThanOrEqual(amplitude + 1e-9);
            expect(Math.abs(out.y)).toBeLessThanOrEqual(amplitude + 1e-9);
            previous = amplitude;
        }
        expect(after(SHAKE_SECONDS)).toBe(0);
        expect(after(SHAKE_SECONDS + 0.1)).toBe(0);
        expect(out).toEqual({ x: 0, y: 0, amplitude: 0 });
    });

    it('does not shake without a shield break or under reduced motion', () => {
        expect(shakeOffset(out, 0, H, false)).toBe(0);
        expect(after(0, true)).toBe(0);
        expect(after(0.1, true)).toBe(0);
        expect(out).toEqual({ x: 0, y: 0, amplitude: 0 });
    });
});
