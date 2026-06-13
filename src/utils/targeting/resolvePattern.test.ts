import { describe, it, expect } from 'vitest';
import { parsePattern } from '../targetingParser';
import { resolveCells, ResolvedCell } from './resolvePattern';

const positions = (cells: ResolvedCell[]) => new Set(cells.map((c) => c.position));
const origins = (cells: ResolvedCell[]) =>
    cells.filter((c) => c.role === 'origin').map((c) => c.position);

describe('resolveCells — confident shapes', () => {
    it('Base = origin only', () => {
        const cells = resolveCells(parsePattern('Pattern-Base'), 'M2');
        expect(cells).toEqual([{ position: 'M2', role: 'origin' }]);
    });

    it('Range-3 from front M4 = M4(origin) + M3,M2,M1 covered', () => {
        const cells = resolveCells(parsePattern('Pattern-Range-3'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'M2', 'M1']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'M3')!.role).toBe('covered');
    });

    it('Range-3 anchored mid-board clips off-board cells', () => {
        const cells = resolveCells(parsePattern('Pattern-Range-3'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M2', 'M1']));
    });
});

describe('resolveCells — special cases', () => {
    it("'all' returns all 12 positions, all origin", () => {
        const cells = resolveCells(parsePattern('Pattern-All'), 'M2');
        expect(cells.length).toBe(12);
        expect(cells.every((c) => c.role === 'origin')).toBe(true);
    });

    it("'Support-All' also resolves via the all case", () => {
        const cells = resolveCells(parsePattern('Pattern-Support-All'), 'M2');
        expect(cells.length).toBe(12);
    });

    it('whole-lane = caster +-2 along the lane, clipped (anchor M3 -> M4,M3,M2,M1)', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-whole-lane'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'M2', 'M1']));
        expect(origins(cells)).toEqual(['M3']);
    });
});

describe('resolveCells — unknown signature', () => {
    it('throws on a pattern with no offset table', () => {
        // Cross has no table yet in Task 2 — this test is REMOVED in Task 6 when Cross gets a table.
        expect(() => resolveCells(parsePattern('Pattern-Cross-Range-1'), 'M2')).toThrow(
            /no offset table|unknown pattern/i
        );
    });
});
