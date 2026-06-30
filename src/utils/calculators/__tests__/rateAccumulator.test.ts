import { describe, it, expect, afterEach } from 'vitest';
import { makeRateGate, setRateGateRng, resetRateGateRng, mulberry32 } from '../rateAccumulator';

// setupTests installs a seeded RNG before each test; these tests override it
// explicitly and reset afterward so they never depend on the global default.
afterEach(() => resetRateGateRng());

describe('makeRateGate (random draws)', () => {
    it('fires when the RNG draw is below the rate', () => {
        setRateGateRng(() => 0.3);
        const gate = makeRateGate();
        expect(gate(0.5)).toBe(true); // 0.3 < 0.5
    });

    it('does not fire when the RNG draw is at or above the rate', () => {
        setRateGateRng(() => 0.5);
        const gate = makeRateGate();
        expect(gate(0.5)).toBe(false); // 0.5 < 0.5 is false
    });

    it('rate >= 1 always fires (RNG is [0,1))', () => {
        setRateGateRng(() => 0.999999);
        const gate = makeRateGate();
        expect(gate(1)).toBe(true);
        expect(gate(1.5)).toBe(true); // clamped to 1
    });

    it('rate <= 0 never fires', () => {
        setRateGateRng(() => 0);
        const gate = makeRateGate();
        expect(gate(0)).toBe(false);
        expect(gate(-0.5)).toBe(false); // clamped to 0
    });

    it('reads the live module RNG at call time, not creation time', () => {
        const gate = makeRateGate();
        setRateGateRng(() => 0.1);
        expect(gate(0.5)).toBe(true);
        setRateGateRng(() => 0.9);
        expect(gate(0.5)).toBe(false);
    });

    it('each gate from makeRateGate draws independently from the same RNG', () => {
        const seq = [0.1, 0.9];
        let i = 0;
        setRateGateRng(() => seq[i++ % seq.length]);
        const a = makeRateGate();
        const b = makeRateGate();
        expect(a(0.5)).toBe(true); // draw 0.1
        expect(b(0.5)).toBe(false); // draw 0.9
    });

    // Statistical check MUST use raw Math.random with a loose tolerance so it
    // cannot flake — it must NOT run under the seeded default.
    it('under real Math.random, ~rate fraction fires over many draws', () => {
        setRateGateRng(Math.random);
        const gate = makeRateGate();
        const N = 100_000;
        let fires = 0;
        for (let i = 0; i < N; i++) if (gate(0.7)) fires++;
        const frac = fires / N;
        expect(frac).toBeGreaterThan(0.68);
        expect(frac).toBeLessThan(0.72);
    });

    it('mulberry32 is deterministic for a given seed', () => {
        const r1 = mulberry32(12345);
        const r2 = mulberry32(12345);
        expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
    });
});
