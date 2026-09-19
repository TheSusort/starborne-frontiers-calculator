import { describe, it, expect } from 'vitest';
import { bandsBetween, bandPriorities, classifyOutcome, BAND_COUNT } from '../statBands';

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

    it('never inverts a band on a narrow fractional range', () => {
        // Math.round(100.4 + tiny) rounds DOWN to 100, which sits below the unrounded floor of
        // 100.4 next to it in the boundary list. A boundary that would fall at or below the
        // previous boundary is dropped instead of kept, so no band can have min > max.
        const bands = bandsBetween(100.4, 100.6);
        expect(bands).toEqual([{ min: 100.4, max: 100.6 }]);
    });

    it('collapses to a single band when floor and ceiling are equal and fractional', () => {
        expect(bandsBetween(100.5, 100.5)).toEqual([{ min: 100.5, max: 100.5 }]);
    });

    it('never inverts a band across a spread of narrow fractional ranges', () => {
        const ranges: [number, number][] = [
            [100.4, 100.6],
            [100.1, 100.9],
            [99.5, 100.5],
            [100.2, 101.8],
            [100.49, 100.51],
            [0.1, 0.3],
            [100.5, 103.5],
        ];
        for (const [floor, ceiling] of ranges) {
            const bands = bandsBetween(floor, ceiling);
            expect(bands.length).toBeGreaterThan(0);
            expect(bands.length).toBeLessThanOrEqual(BAND_COUNT);
            expect(bands[0].min).toBe(floor);
            expect(bands[bands.length - 1].max).toBe(ceiling);
            for (const band of bands) {
                expect(band.min).toBeLessThan(band.max);
            }
            for (let i = 1; i < bands.length; i++) {
                expect(bands[i].min).toBe(bands[i - 1].max);
            }
        }
    });
});

describe('bandPriorities', () => {
    // A band is a PREFERENCE, never a hard requirement: nobody knows where the bound belongs —
    // that is what the run measures — and a hard requirement asserts a certainty the run does
    // not have. See `bandPriorities`' own doc.
    it('emits a soft limit the optimizer may overrule', () => {
        const [priority] = bandPriorities('hacking', { min: 150, max: 300 });
        expect(priority.hardRequirement).toBeUndefined();
        expect(priority.minLimit).toBe(150);
        expect(priority.maxLimit).toBe(300);
        expect(priority.stat).toBe('hacking');
    });
});

describe('classifyOutcome', () => {
    it('marks a landed value inside the band as within it', () => {
        expect(classifyOutcome({ min: 150, max: 300 }, 220).withinBand).toBe(true);
    });

    // A soft band does not stop the optimizer leaving it, and nothing else in the result says
    // that it did. Reporting the landed value alone would present a build the run never asked
    // for as the band's answer.
    it('reports a landed value outside the band rather than accepting it as the band result', () => {
        const outcome = classifyOutcome({ min: 0, max: 150 }, 440);
        expect(outcome.withinBand).toBe(false);
        expect(outcome.landed).toBe(440);
    });

    it('treats the boundaries as inside the band', () => {
        expect(classifyOutcome({ min: 150, max: 300 }, 150).withinBand).toBe(true);
        expect(classifyOutcome({ min: 150, max: 300 }, 300).withinBand).toBe(true);
    });
});
