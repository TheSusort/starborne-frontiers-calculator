import { describe, it, expect } from 'vitest';
import {
    bandsBetween,
    bandPriorities,
    classifyOutcome,
    probePriorities,
    BAND_COUNT,
} from '../statBands';

describe('bandsBetween', () => {
    it('divides the achievable range into BAND_COUNT contiguous bands', () => {
        const bands = bandsBetween(100, 600);
        expect(bands).toHaveLength(BAND_COUNT);
        expect(bands[0].min).toBe(100);
        expect(bands[BAND_COUNT - 1].max).toBe(600);
        // Contiguous: each band's min is exactly the previous band's max, so there is no
        // integer between them a real build could land on and be wrongly classified
        // unreachable. A weaker `<=` check would also pass for a run of identical bands.
        for (let i = 1; i < bands.length; i++) {
            expect(bands[i].min).toBe(bands[i - 1].max);
        }
        // Non-degenerate: every band actually spans a range, and no two bands duplicate
        // each other — a duplicate band would cost a full optimizer pass for no new signal.
        for (const band of bands) {
            expect(band.min).toBeLessThan(band.max);
        }
        const seen = new Set(bands.map((b) => `${b.min}-${b.max}`));
        expect(seen.size).toBe(bands.length);
    });

    it('collapses to a single band when the stat cannot move at all', () => {
        // A floor equal to the ceiling means the inventory offers no choice. Five identical
        // bands would run five identical optimizer passes for one answer.
        expect(bandsBetween(300, 300)).toEqual([{ min: 300, max: 300 }]);
    });

    it('collapses duplicate boundaries when the range is narrower than BAND_COUNT', () => {
        // A 3-point range split five ways would otherwise produce zero-width/duplicate bands
        // (e.g. two separate [101, 101] bands) — each a wasted optimizer pass.
        const bands = bandsBetween(100, 103);
        expect(bands.length).toBeLessThan(BAND_COUNT);
        expect(bands).toEqual([
            { min: 100, max: 101 },
            { min: 101, max: 102 },
            { min: 102, max: 103 },
        ]);
    });

    it('never emits an inverted band when floor exceeds ceiling', () => {
        expect(() => bandsBetween(600, 100)).toThrow();
    });

    it('uses the exact floor and ceiling at the edges, not a rounded approximation', () => {
        // Math.round(600.5) === 601 in JS, so a boundary computed by rounding rather than
        // taking the ceiling verbatim would exclude the ceiling build from the last band —
        // and symmetrically at the floor for a fractional lower bound.
        const bands = bandsBetween(100.4, 600.5);
        expect(bands[0].min).toBe(100.4);
        expect(bands[bands.length - 1].max).toBe(600.5);
    });
});

describe('bandPriorities', () => {
    it('emits a HARD requirement, which only Genetic honours', () => {
        const [priority] = bandPriorities('hacking', { min: 150, max: 300 });
        expect(priority.hardRequirement).toBe(true);
        expect(priority.minLimit).toBe(150);
        expect(priority.maxLimit).toBe(300);
        expect(priority.stat).toBe('hacking');
    });
});

describe('classifyOutcome', () => {
    it('marks a landed value inside the band reachable', () => {
        expect(classifyOutcome({ min: 150, max: 300 }, 220).reachable).toBe(true);
    });

    // The measured failure: asking for 0-150 against a 440 floor silently returns 440.
    it('marks a landed value outside the band UNREACHABLE rather than accepting it', () => {
        const outcome = classifyOutcome({ min: 0, max: 150 }, 440);
        expect(outcome.reachable).toBe(false);
        expect(outcome.landed).toBe(440);
    });

    it('treats the boundaries as inside the band', () => {
        expect(classifyOutcome({ min: 150, max: 300 }, 150).reachable).toBe(true);
        expect(classifyOutcome({ min: 150, max: 300 }, 300).reachable).toBe(true);
    });
});

describe('probePriorities', () => {
    it('pins a single value, so the optimizer lands on the nearest reachable one', () => {
        const [priority] = probePriorities('hacking', 0);
        expect(priority.minLimit).toBe(0);
        expect(priority.maxLimit).toBe(0);
        expect(priority.hardRequirement).toBe(true);
    });
});
