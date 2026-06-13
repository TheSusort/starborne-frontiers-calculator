import { describe, it, expect } from 'vitest';
import { ALL_POSITIONS, neighbors, inBoundsAxial, positionToAxial, axialToPosition } from './board';

describe('board adjacency', () => {
    it('M2 has the confirmed six neighbors', () => {
        expect(new Set(neighbors('M2'))).toEqual(new Set(['T1', 'T2', 'M1', 'M3', 'B1', 'B2']));
    });

    it('front-top corner T4 has only T3 and M4', () => {
        expect(new Set(neighbors('T4'))).toEqual(new Set(['T3', 'M4']));
    });

    it('back-bottom corner B1 neighbors are B2, M1, M2', () => {
        // M2↔B1 is part of the confirmed M2 set, so by symmetry B1 reaches M2 too.
        expect(new Set(neighbors('B1'))).toEqual(new Set(['B2', 'M1', 'M2']));
    });

    it('neighbor relation is symmetric over all 12 cells', () => {
        for (const a of ALL_POSITIONS) {
            for (const b of neighbors(a)) {
                expect(neighbors(b)).toContain(a);
            }
        }
    });

    it('every cell has between 2 and 6 neighbors', () => {
        for (const p of ALL_POSITIONS) {
            const n = neighbors(p).length;
            expect(n).toBeGreaterThanOrEqual(2);
            expect(n).toBeLessThanOrEqual(6);
        }
    });
});

describe('axial conversion', () => {
    it('round-trips every position', () => {
        for (const p of ALL_POSITIONS) {
            const a = positionToAxial(p);
            expect(axialToPosition(a.q, a.r)).toBe(p);
        }
    });

    it('M2 is at (0,1) and front column 4 is at q=2..3', () => {
        expect(positionToAxial('M2')).toEqual({ q: 0, r: 1 });
        expect(positionToAxial('T4')).toEqual({ q: 3, r: 0 });
        expect(positionToAxial('M4')).toEqual({ q: 2, r: 1 });
    });

    it('inBoundsAxial is false off the board, true on it', () => {
        expect(inBoundsAxial(0, 1)).toBe(true); // M2
        expect(inBoundsAxial(-2, 1)).toBe(false); // past M1
        expect(inBoundsAxial(4, 0)).toBe(false); // past T4
        expect(axialToPosition(-2, 1)).toBeUndefined();
    });
});
