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

describe('resolveCells — Line family (Task 3)', () => {
    // Line-Range-1: origin + 1 step back.  Anchor M4 keeps full footprint on-board.
    it('Line-Range-1 @ M4 → origin M4, covered M3', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'M3')!.role).toBe('covered');
    });

    // Line-Range-2: origin + 2 steps back.  Anchor M4.
    it('Line-Range-2 @ M4 → origin M4, covered M3 M2', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Range-2'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'M2']));
        expect(origins(cells)).toEqual(['M4']);
    });

    // Line-Range-3: origin + 3 steps back.  Anchor M4.
    // TODO verify vs PNG (no PNG available — derived by extending Range-1/2 progression)
    it('Line-Range-3 @ M4 → origin M4, covered M3 M2 M1', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Range-3'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'M2', 'M1']));
        expect(origins(cells)).toEqual(['M4']);
    });

    // Line-from-centre-Range-1: origin in middle, 1 step front + 1 step back.
    // Anchor M3 keeps both neighbours on-board (M4 front, M2 back).
    it('Line-from-centre-Range-1 @ M3 → origin M3, covered M4 M2', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-from-centre-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4', 'M2']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // Line-Support-Range-1: support pattern, 1 hex = origin only.
    // Anchor M3.
    it('Line-Support-Range-1 @ M3 → origin M3 only', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // Line-Support-Range-2: origin + 1 covered step back.  Anchor M3.
    it('Line-Support-Range-2 @ M3 → origin M3, covered M2', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-Range-2'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M2']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // Line-Support-Range-3: origin + 2 covered steps back.  Anchor M3.
    it('Line-Support-Range-3 @ M3 → origin M3, covered M2 M1', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-Range-3'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M2', 'M1']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // Line-Support-Not-Self-Range-2: range-2 reach beyond caster, caster excluded (notSelf).
    // Anchor M3 (axial (1,1)): cov(-1,0) → M2(0,1), cov(-2,0) → M1(-1,1).
    it('Line-Support-Not-Self-Range-2 @ M3 → no origin, covered M2 M1', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-Not-Self-Range-2'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M2', 'M1']));
        expect(origins(cells)).toEqual([]);
    });

    // Clipping: Line-Range-2 anchored at M2 clips M1... wait M1 exists.
    // Let's verify Line-Range-3 clips when anchored at M2 (M2 back -> M1 -> off-board).
    it('Line-Range-3 @ M2 clips cells that fall off-board', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Range-3'), 'M2');
        // M2(origin), M1(cov -1), then (-2,1) and (-3,1) are off-board
        expect(positions(cells)).toEqual(new Set(['M2', 'M1']));
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

describe('resolveCells — Cone family (Task 4)', () => {
    // ---------------------------------------------------------------------------
    // Cone-Range-1: tip at FRONT, fans back.
    // Offsets: ORIGIN(0,0), cov(-1,0), cov(0,-1), cov(-1,+1)
    // Anchor M4(q=2,r=1): origin M4, back→M3, up-back T3, down-back B3.
    // ---------------------------------------------------------------------------
    it('Cone-Range-1 @ M4 → origin M4, covered {M3, T3, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Cone-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'T3', 'B3']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'M3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'T3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B3')!.role).toBe('covered');
    });

    // Clipping: anchor M2(q=0,r=1) — cov(-1,0)→M1(-1,1), cov(0,-1)→T1(0,0),
    // cov(-1,+1)→B at (-1,2) = B1... wait B1=(-1,2) ✓ → {M2,M1,T1,B1} all on-board.
    // Anchor M1(q=-1,r=1): cov(-1,0)→(-2,1) off-board, cov(0,-1)→T(-1,0)=off-board,
    // cov(-1,+1)→(-2,2) off-board.
    it('Cone-Range-1 @ M1 clips all covered cells (all off-board)', () => {
        const cells = resolveCells(parsePattern('Pattern-Cone-Range-1'), 'M1');
        // M1(q=-1,r=1): back→(-2,1) off, up-back→(-1,0) off, down-back→(-2,2) off
        expect(positions(cells)).toEqual(new Set(['M1']));
        expect(origins(cells)).toEqual(['M1']);
    });

    // ---------------------------------------------------------------------------
    // Cone-Back-Range-1: origin at BACK, wide 2-layer forward fan (6 cells total).
    // Offsets: ORIGIN(0,0), cov(+1,0), cov(+1,-1), cov(0,+1), cov(+2,-1), cov(+1,+1)
    // Anchor M2(q=0,r=1): front→M3, T-upfront→T2, B-downfront→B2, T-further→T3, B-further→B3.
    // ---------------------------------------------------------------------------
    it('Cone-Back-Range-1 @ M2 → origin M2, covered {M3, T2, B2, T3, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Cone-Back-Range-1'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M2', 'M3', 'T2', 'B2', 'T3', 'B3']));
        expect(origins(cells)).toEqual(['M2']);
    });

    // ---------------------------------------------------------------------------
    // Cone-Support-Range-1: single origin hex, no covered area.
    // ---------------------------------------------------------------------------
    it('Cone-Support-Range-1 @ M3 → origin M3 only', () => {
        const cells = resolveCells(parsePattern('Pattern-Cone-Support-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // ---------------------------------------------------------------------------
    // Prolonged_Cone-Support-Range-2: origin at front, 2-step back line + T+B fan.
    // Offsets: ORIGIN(0,0), cov(-1,0), cov(-2,0), cov(0,-1), cov(-1,+1)
    // Anchor M4(q=2,r=1): back1→M3, back2→M2, up-back→T3, down-back→B3.
    // ---------------------------------------------------------------------------
    it('Prolonged_Cone-Support-Range-2 @ M4 → origin M4, covered {M3, M2, T3, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Prolonged_Cone-Support-Range-2'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'M2', 'T3', 'B3']));
        expect(origins(cells)).toEqual(['M4']);
    });

    // ---------------------------------------------------------------------------
    // Reverse-Cone-Range-1: tip at BACK, fans forward (mirror of Cone-Range-1).
    // Offsets: ORIGIN(0,0), cov(+1,0), cov(+1,-1), cov(0,+1)
    // Anchor M3(q=1,r=1): front→M4, up-front→T3, down-front→B3.
    // ---------------------------------------------------------------------------
    it('Reverse-Cone-Range-1 @ M3 → origin M3, covered {M4, T3, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Reverse-Cone-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4', 'T3', 'B3']));
        expect(origins(cells)).toEqual(['M3']);
        expect(cells.find((c) => c.position === 'M4')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'T3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B3')!.role).toBe('covered');
    });

    // Clipping: anchor M4(q=2,r=1) — front(+1,0)→(3,1)=off-board (no M5),
    // up-front(+1,-1)→T4(3,0) ✓, down-front(0,+1)→B4(2,2) ✓.
    it('Reverse-Cone-Range-1 @ M4 clips off-board front M cell', () => {
        const cells = resolveCells(parsePattern('Pattern-Reverse-Cone-Range-1'), 'M4');
        // M4(origin), front(+1,0)→(3,1) off-board, T4(3,0) ✓, B4(2,2) ✓
        expect(positions(cells)).toEqual(new Set(['M4', 'T4', 'B4']));
        expect(origins(cells)).toEqual(['M4']);
    });
});
