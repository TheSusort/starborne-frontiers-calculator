import { existsSync, readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { parsePattern, parseTargetingCsv } from '../targetingParser';
import { resolveCells, ResolvedCell } from './resolvePattern';
import { ALL_POSITIONS } from './board';
import { CORPUS_PATTERNS } from './__fixtures__/corpusPatterns';

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

    // Line-Range-3: origin + 3 steps back.  Anchor M4.  Confirmed vs Pattern-Range-3.png.
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

    // Line-Support-Range-1: support extends FORWARD (+q) from caster; caster IS included.
    // Anchor M3: ORIGIN=M3, cov(1,0) → M4.
    it('Line-Support-Range-1 @ M3 → origin M3, covered {M4}', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // Line-Support-Range-3: support extends FORWARD (+q) from caster; caster IS included.
    // Anchor M1(-1,1): ORIGIN=M1, cov(1,0)→M2, cov(2,0)→M3, cov(3,0)→M4.
    it('Line-Support-Range-3 @ M1 → origin M1, covered {M2, M3, M4}', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-Range-3'), 'M1');
        expect(positions(cells)).toEqual(new Set(['M1', 'M2', 'M3', 'M4']));
        expect(origins(cells)).toEqual(['M1']);
    });

    // Line-Support-Not-Self-Range-2: support extends FORWARD (+q), caster excluded (notSelf).
    // Anchor M2 (axial (0,1)): cov(1,0) → M3(1,1), cov(2,0) → M4(2,1).  No origin.
    it('Line-Support-Not-Self-Range-2 @ M2 → no origin, covered {M3, M4}', () => {
        const cells = resolveCells(parsePattern('Pattern-Line-Support-Not-Self-Range-2'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4']));
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

describe('resolveCells — Circle family (Task 5)', () => {
    // ---------------------------------------------------------------------------
    // Circle-Range-1: origin + all 6 neighbor directions (full ring, 7 cells).
    // Anchor M3(q=1,r=1) keeps the entire ring on-board:
    //   back(-1,0)→M2, front(+1,0)→M4, up-back(0,-1)→T2, up-front(+1,-1)→T3,
    //   down-back(-1,+1)→B2, down-front(0,+1)→B3.
    // ---------------------------------------------------------------------------
    it('Circle-Range-1 @ M3 → origin M3, covered {M2, M4, T2, T3, B2, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Circle-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M2', 'M4', 'T2', 'T3', 'B2', 'B3']));
        expect(origins(cells)).toEqual(['M3']);
        expect(cells.find((c) => c.position === 'M2')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'T2')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B3')!.role).toBe('covered');
    });

    // Clipping: anchor M4(q=2,r=1) — front(+1,0)→(3,1) off-board; rest land on-board.
    // back(-1,0)→M3, up-back(0,-1)→T3, up-front(+1,-1)→T4, down-back(-1,+1)→B3,
    // down-front(0,+1)→B4.
    it('Circle-Range-1 @ M4 clips off-board front cell', () => {
        const cells = resolveCells(parsePattern('Pattern-Circle-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'T3', 'T4', 'B3', 'B4']));
        expect(origins(cells)).toEqual(['M4']);
    });

    // ---------------------------------------------------------------------------
    // Circle-Support-Range-1: same geometry as Circle-Range-1, support variant (yellow).
    // Anchor M3.
    // ---------------------------------------------------------------------------
    it('Circle-Support-Range-1 @ M3 → origin M3, covered {M2, M4, T2, T3, B2, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Circle-Support-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M2', 'M4', 'T2', 'T3', 'B2', 'B3']));
        expect(origins(cells)).toEqual(['M3']);
    });
});

describe('resolveCells — Backline family (Task 5)', () => {
    // ---------------------------------------------------------------------------
    // Backline-Range-1: origin at BACK cell, 1 covered step forward (+q).
    // Game rule: backline patterns target the back of the enemy formation and
    // splash toward the front (+q direction).
    // Anchor M1(q=-1,r=1): front(+1,0)→M2(0,1).
    // ---------------------------------------------------------------------------
    it('Backline-Range-1 @ M1 → origin M1, covered M2', () => {
        const cells = resolveCells(parsePattern('Pattern-Backline-Range-1'), 'M1');
        expect(positions(cells)).toEqual(new Set(['M1', 'M2']));
        expect(origins(cells)).toEqual(['M1']);
        expect(cells.find((c) => c.position === 'M2')!.role).toBe('covered');
    });

    // Clipping: anchor M3(q=1,r=1) — front(+1,0)→M4(2,1) ✓, 2-front would be off-board.
    it('Backline-Range-1 @ M3 → origin M3, covered M4', () => {
        const cells = resolveCells(parsePattern('Pattern-Backline-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // ---------------------------------------------------------------------------
    // Backline-Range-2: origin at BACK, 2 covered steps forward (+q, +2q).
    // Anchor M1(q=-1,r=1): front(+1,0)→M2(0,1), 2front(+2,0)→M3(1,1).
    // ---------------------------------------------------------------------------
    it('Backline-Range-2 @ M1 → origin M1, covered {M2, M3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Backline-Range-2'), 'M1');
        expect(positions(cells)).toEqual(new Set(['M1', 'M2', 'M3']));
        expect(origins(cells)).toEqual(['M1']);
        expect(cells.find((c) => c.position === 'M2')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'M3')!.role).toBe('covered');
    });

    // Clipping: anchor M2(q=0,r=1) — front(+1,0)→M3(1,1) ✓, 2front(+2,0)→M4(2,1) ✓.
    it('Backline-Range-2 @ M2 → origin M2, covered {M3, M4}', () => {
        const cells = resolveCells(parsePattern('Pattern-Backline-Range-2'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M2', 'M3', 'M4']));
        expect(origins(cells)).toEqual(['M2']);
    });

    // Clipping: anchor M3(q=1,r=1) — front(+1,0)→M4(2,1) ✓, 2front(+2,0)→(3,1) off-board.
    it('Backline-Range-2 @ M3 clips off-board 2-front cell', () => {
        const cells = resolveCells(parsePattern('Pattern-Backline-Range-2'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4']));
        expect(origins(cells)).toEqual(['M3']);
    });
});

describe('resolveCells — Cross family (Task 6)', () => {
    // ---------------------------------------------------------------------------
    // Cross-Range-1: origin in M row + 4 diagonal neighbors (all 4 off-row directions).
    // Offsets: ORIGIN(0,0), cov(0,-1)[up-back], cov(+1,-1)[up-front],
    //   cov(-1,+1)[down-back], cov(0,+1)[down-front]
    // Anchor M3(q=1,r=1): up-back→T2(1,0), up-front→T3(2,0),
    //   down-back→B2(0,2), down-front→B3(1,2).
    // ---------------------------------------------------------------------------
    it('Cross-Range-1 @ M3 → origin M3, covered {T2, T3, B2, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Cross-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'T2', 'T3', 'B2', 'B3']));
        expect(origins(cells)).toEqual(['M3']);
        expect(cells.find((c) => c.position === 'T2')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'T3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B2')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B3')!.role).toBe('covered');
    });

    // Clipping: anchor M1(q=-1,r=1) — up-back(0,-1)→(-1,0) off-board, up-front(+1,-1)→(0,0)=T1,
    //   down-back(-1,+1)→(-2,2) off-board, down-front(0,+1)→(-1,2)=B1.
    it('Cross-Range-1 @ M1 clips 2 off-board diagonals', () => {
        const cells = resolveCells(parsePattern('Pattern-Cross-Range-1'), 'M1');
        expect(positions(cells)).toEqual(new Set(['M1', 'T1', 'B1']));
        expect(origins(cells)).toEqual(['M1']);
    });
});

describe('resolveCells — Curve family (Task 6)', () => {
    // ---------------------------------------------------------------------------
    // Curve-Range-1: origin in M row + up-back(0,-1) + down-back(-1,+1).
    // Anchor M4(q=2,r=1): up-back→T3(2,0), down-back→B3(1,2).
    // ---------------------------------------------------------------------------
    it('Curve-Range-1 @ M4 → origin M4, covered {T3, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Curve-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'T3', 'B3']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'T3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B3')!.role).toBe('covered');
    });

    // Clipping: anchor M1(q=-1,r=1) — up-back(0,-1)→(-1,0) off-board,
    //   down-back(-1,+1)→(-2,2) off-board. Only origin remains.
    it('Curve-Range-1 @ M1 clips all covered (both off-board)', () => {
        const cells = resolveCells(parsePattern('Pattern-Curve-Range-1'), 'M1');
        expect(positions(cells)).toEqual(new Set(['M1']));
        expect(origins(cells)).toEqual(['M1']);
    });

    // ---------------------------------------------------------------------------
    // Reverse-Curve-Range-1: origin in M row + up-front(+1,-1) + down-front(0,+1).
    // Mirror of Curve. Anchor M3(q=1,r=1): up-front→T3(2,0), down-front→B3(1,2).
    // ---------------------------------------------------------------------------
    it('Reverse-Curve-Range-1 @ M3 → origin M3, covered {T3, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Reverse-Curve-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'T3', 'B3']));
        expect(origins(cells)).toEqual(['M3']);
        expect(cells.find((c) => c.position === 'T3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B3')!.role).toBe('covered');
    });

    // Clipping: anchor M4(q=2,r=1) — up-front(+1,-1)→T4(3,0) ✓, down-front(0,+1)→B4(2,2) ✓.
    // (T4 and B4 are on-board, so no clipping for M4.)
    it('Reverse-Curve-Range-1 @ M4 → origin M4, covered {T4, B4}', () => {
        const cells = resolveCells(parsePattern('Pattern-Reverse-Curve-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'T4', 'B4']));
        expect(origins(cells)).toEqual(['M4']);
    });
});

describe('resolveCells — Root family (Task 6)', () => {
    // ---------------------------------------------------------------------------
    // Root-Range-1: origin at FRONT-M + M-back(-1,0) + T-back(-1,-1) + B-back(-2,+1).
    // Anchor M4(q=2,r=1): back→M3(-1,0), T-back→T2(-1,-1), B-back→B2(-2,+1).
    // ---------------------------------------------------------------------------
    it('Root-Range-1 @ M4 → origin M4, covered {M3, T2, B2}', () => {
        const cells = resolveCells(parsePattern('Pattern-Root-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'T2', 'B2']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'M3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'T2')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B2')!.role).toBe('covered');
    });

    // Clipping: anchor M1(q=-1,r=1) — cov(-1,0)→(-2,1) off-board,
    //   cov(-1,-1)→(-2,0) off-board, cov(-2,1)→(-3,2) off-board. Only origin M1 remains.
    it('Root-Range-1 @ M1 clips all covered cells (all off-board)', () => {
        const cells = resolveCells(parsePattern('Pattern-Root-Range-1'), 'M1');
        expect(positions(cells)).toEqual(new Set(['M1']));
        expect(origins(cells)).toEqual(['M1']);
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
    // Cone-Support-Range-1: support extends FORWARD (+q); caster IS included (ORIGIN).
    // Anchor M3(1,1): ORIGIN=M3, cov(1,-1)→T3(2,0), cov(1,0)→M4(2,1), cov(0,1)→B3(1,2).
    // ---------------------------------------------------------------------------
    it('Cone-Support-Range-1 @ M3 → origin M3, covered {T3, M4, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Cone-Support-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'T3', 'M4', 'B3']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // ---------------------------------------------------------------------------
    // Prolonged_Cone-Support-Range-2: support extends FORWARD (+q); caster IS included (ORIGIN).
    // Offsets: ORIGIN, cov(1,-1), cov(1,0), cov(2,0), cov(0,+1)
    // Anchor M2(q=0,r=1): ORIGIN=M2, cov(1,-1)→T2(1,0), cov(1,0)→M3(1,1), cov(2,0)→M4(2,1), cov(0,1)→B2(0,2).
    // ---------------------------------------------------------------------------
    it('Prolonged_Cone-Support-Range-2 @ M2 → origin M2, covered {T2, M3, M4, B2}', () => {
        const cells = resolveCells(parsePattern('Pattern-Prolonged_Cone-Support-Range-2'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M2', 'T2', 'M3', 'M4', 'B2']));
        expect(origins(cells)).toEqual(['M2']);
    });

    // ---------------------------------------------------------------------------
    // Prolonged_Cone-Support-Center-Range-2: anchor:center variant; caster IS included (ORIGIN).
    // Offsets: ORIGIN, cov(0,-1), cov(-1,0), cov(1,0), cov(-1,+1)
    // Anchor M3(q=1,r=1): ORIGIN=M3, cov(0,-1)→T2(1,0), cov(-1,0)→M2(0,1), cov(1,0)→M4(2,1), cov(-1,+1)→B2(0,2).
    // ---------------------------------------------------------------------------
    it('Prolonged_Cone-Support-Center-Range-2 @ M3 → origin M3, covered {T2, M2, M4, B2}', () => {
        const cells = resolveCells(
            parsePattern('Pattern-Prolonged_Cone-Support-Center-Range-2'),
            'M3'
        );
        expect(positions(cells)).toEqual(new Set(['M3', 'T2', 'M2', 'M4', 'B2']));
        expect(origins(cells)).toEqual(['M3']);
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

describe('resolveCells — Task 7: Split / Burst / Scattershot / Wings / Pickaxe / Base-Support', () => {
    // -----------------------------------------------------------------------
    // Split-Range-1: origin front-M + T-back diagonal + B-back diagonal (3 cells).
    // Anchor M4(2,1): origin M4, T2(-1,-1)=(1,0), B2(-2,+1)=(0,2).
    // -----------------------------------------------------------------------
    it('Split-Range-1 @ M4 → origin M4, covered {T2, B2}', () => {
        const cells = resolveCells(parsePattern('Pattern-Split-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'T2', 'B2']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'T2')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B2')!.role).toBe('covered');
    });

    // Clipping: anchor M2(0,1): cov(-1,-1)→(-1,0)=off, cov(-2,+1)→(-2,2)=off. Only origin remains.
    it('Split-Range-1 @ M2 clips all covered (both off-board)', () => {
        const cells = resolveCells(parsePattern('Pattern-Split-Range-1'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M2']));
        expect(origins(cells)).toEqual(['M2']);
    });

    // -----------------------------------------------------------------------
    // Burst-Range-1: origin front-M + M3(-1,0) + T3(0,-1) + T2(-1,-1) + B3(-1,+1) + B2(-2,+1).
    // Anchor M4(2,1): M3=(1,1), T3=(2,0), T2=(1,0), B3=(1,2), B2=(0,2).
    // (corrected: cov(-2,0)=M2 was a typo; correct is cov(-1,0)=M3.)
    // -----------------------------------------------------------------------
    it('Burst-Range-1 @ M4 → origin M4, covered {M3, T3, T2, B3, B2}', () => {
        const cells = resolveCells(parsePattern('Pattern-Burst-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'T3', 'T2', 'B3', 'B2']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'T3')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B3')!.role).toBe('covered');
    });

    // Anchor M3(1,1): cov(-1,-1)→T1(0,0)✓, cov(0,-1)→T2(1,0)✓, cov(-1,0)→M2(0,1)✓,
    //   cov(-2,+1)→B1(-1,2)✓, cov(-1,+1)→B2(0,2)✓.
    it('Burst-Range-1 @ M3 → origin M3, covered {M2, T2, T1, B2, B1}', () => {
        const cells = resolveCells(parsePattern('Pattern-Burst-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M2', 'T2', 'T1', 'B2', 'B1']));
        expect(origins(cells)).toEqual(['M3']);
    });

    // -----------------------------------------------------------------------
    // Scattershot-Range-1: origin front-M + M2(-2,0) + T2(-1,-1) + B2(-2,+1).
    // Anchor M4: origin M4, covered {M2, T2, B2}.
    // -----------------------------------------------------------------------
    it('Scattershot-Range-1 @ M4 → origin M4, covered {M2, T2, B2}', () => {
        const cells = resolveCells(parsePattern('Pattern-Scattershot-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M2', 'T2', 'B2']));
        expect(origins(cells)).toEqual(['M4']);
        expect(cells.find((c) => c.position === 'M2')!.role).toBe('covered');
    });

    // -----------------------------------------------------------------------
    // Wings-Support-Not-Self-Range-2: support, notSelf — zero origins.
    // Offsets: cov(0,-1), cov(1,-1), cov(-1,+1), cov(0,+1), cov(-2,+2), cov(-1,+2), cov(0,+2).
    // Human-verified @ M3: (no origin) covered {T2,T3,B2,B3} (3 offsets clip off-board).
    // Human-verified @ T2: (no origin) covered {M2,M3,B1,B2,B3} (2 offsets clip off-board).
    // -----------------------------------------------------------------------
    it('Wings-Support-Not-Self-Range-2 @ M3 → no origin, covered {T2, T3, B2, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Wings-Support-Not-Self-Range-2'), 'M3');
        expect(positions(cells)).toEqual(new Set(['T2', 'T3', 'B2', 'B3']));
        expect(origins(cells)).toEqual([]);
        expect(cells.every((c) => c.role === 'covered')).toBe(true);
    });

    // Second anchor T2(1,0): cov(0,-1)→(1,-1)=off, cov(1,-1)→(2,-1)=off, cov(-1,+1)→(0,1)=M2✓,
    //   cov(0,+1)→(1,1)=M3✓, cov(-2,+2)→(-1,2)=B1✓, cov(-1,+2)→(0,2)=B2✓, cov(0,+2)→(1,2)=B3✓.
    it('Wings-Support-Not-Self-Range-2 @ T2 → no origin, covered {M2, M3, B1, B2, B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Wings-Support-Not-Self-Range-2'), 'T2');
        expect(positions(cells)).toEqual(new Set(['M2', 'M3', 'B1', 'B2', 'B3']));
        expect(origins(cells)).toEqual([]);
    });

    // Clipping: anchor M4(2,1): cov(0,-1)→T3(2,0)✓, cov(1,-1)→T4(3,0)✓, cov(-1,+1)→B3(1,2)✓,
    //   cov(0,+1)→B4(2,2)✓, cov(-2,+2)→(0,3)=off, cov(-1,+2)→(1,3)=off, cov(0,+2)→(2,3)=off.
    it('Wings-Support-Not-Self-Range-2 @ M4 → no origin, covered {T3, T4, B3, B4}', () => {
        const cells = resolveCells(parsePattern('Pattern-Wings-Support-Not-Self-Range-2'), 'M4');
        expect(positions(cells)).toEqual(new Set(['T3', 'T4', 'B3', 'B4']));
        expect(origins(cells)).toEqual([]);
    });

    // Top wing (outer 3-row + inner 2-row) lands on-board at a back anchor.
    // Anchor B2(0,2): top cov(0,-2)→T1(0,0)✓, cov(1,-2)→T2(1,0)✓, cov(2,-2)→T3(2,0)✓,
    //   cov(0,-1)→M2(0,1)✓, cov(1,-1)→M3(1,1)✓; bottom wing all clips off-board.
    it('Wings-Support-Not-Self-Range-2 @ B2 → no origin, top wing covered {T1,T2,T3,M2,M3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Wings-Support-Not-Self-Range-2'), 'B2');
        expect(positions(cells)).toEqual(new Set(['T1', 'T2', 'T3', 'M2', 'M3']));
        expect(origins(cells)).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Support-Forward-Circle-Range-1: forward-circle centered one cell ahead of caster.
    // ORIGIN = caster (anchor); circle extends forward (+q).
    // 7 cells: ORIGIN + cov(1,-1) + cov(2,-1) + cov(1,0) + cov(2,0) + cov(0,1) + cov(1,1).
    // Anchor M2(0,1): ORIGIN=M2, T2(1,-1→1,0)✓, T3(2,-1→2,0)✓, M3(1,0→1,1)✓,
    //   M4(2,0→2,1)✓, B2(0,1→0,2)✓, B3(1,1→1,2)✓.
    // -----------------------------------------------------------------------
    it('Support-Forward-Circle-Range-1 @ M2 → origin M2, covered {T2,T3,M3,M4,B2,B3}', () => {
        const cells = resolveCells(parsePattern('Pattern-Support-Forward-Circle-Range-1'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M2', 'T2', 'T3', 'M3', 'M4', 'B2', 'B3']));
        expect(origins(cells)).toEqual(['M2']);
        expect(cells.find((c) => c.position === 'M3')!.role).toBe('covered');
    });

    // Clipping: anchor M4(2,1): cov(1,-1)→T4(3,0)✓, cov(2,-1)→(4,0)=off,
    //   cov(1,0)→(3,1)=off, cov(2,0)→(4,1)=off, cov(0,1)→B4(2,2)✓, cov(1,1)→(3,2)=off.
    it('Support-Forward-Circle-Range-1 @ M4 clips most forward cells → origin M4, covered {T4,B4}', () => {
        const cells = resolveCells(parsePattern('Pattern-Support-Forward-Circle-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'T4', 'B4']));
        expect(origins(cells)).toEqual(['M4']);
    });

    // -----------------------------------------------------------------------
    // Support-Double-Pickaxe-Range-0: origin center-M + spine + T/B heads (7 cells).
    // ORIGIN(M3) + M4(+1,0) + M2(-1,0) + T4(+2,-1) + B4(+1,+1) + T1(-1,-1) + B1(-2,+1).
    // Anchor M3(1,1): M4=(2,1)✓, M2=(0,1)✓, T4=(3,0)✓, B4=(2,2)✓, T1=(0,0)✓, B1=(-1,2)✓.
    // -----------------------------------------------------------------------
    it('Support-Double-Pickaxe-Range-0 @ M3 → origin M3, covered {M4,M2,T4,B4,T1,B1}', () => {
        const cells = resolveCells(parsePattern('Pattern-Support-Double-Pickaxe-Range-0'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4', 'M2', 'T4', 'B4', 'T1', 'B1']));
        expect(origins(cells)).toEqual(['M3']);
        expect(cells.find((c) => c.position === 'M4')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'T4')!.role).toBe('covered');
    });

    // Clipping: anchor M2(0,1): cov(+1,0)→M3✓, cov(-1,0)→M1✓,
    //   cov(+2,-1)→T3(2,0)✓, cov(+1,+1)→B3(1,2)✓,
    //   cov(-1,-1)→(-1,0)=off, cov(-2,+1)→(-2,2)=off.
    it('Support-Double-Pickaxe-Range-0 @ M2 clips 2 off-board back-head cells', () => {
        const cells = resolveCells(parsePattern('Pattern-Support-Double-Pickaxe-Range-0'), 'M2');
        expect(positions(cells)).toEqual(new Set(['M2', 'M3', 'M1', 'T3', 'B3']));
        expect(origins(cells)).toEqual(['M2']);
    });

    // -----------------------------------------------------------------------
    // Support-Double-Pickaxe-Range-1: derived from pickaxe|0| + cov(-2,0) + cov(2,0)
    //   (contiguous 5-cell M-spine {-2,-1,0,+1,+2}; the +2 forward tip clips at front anchors).
    // ORIGIN(M3) + M4(+1,0) + M2(-1,0) + M1(-2,0) + forward(+2,0) + T4(+2,-1) + B4(+1,+1)
    //   + T1(-1,-1) + B1(-2,+1).
    // Anchor M3(1,1): M4✓, M2✓, M1✓, cov(2,0)→(3,1)=off, T4=(3,0)✓, B4=(2,2)✓, T1=(0,0)✓, B1=(-1,2)✓.
    // -----------------------------------------------------------------------
    it('Support-Double-Pickaxe-Range-1 @ M3 → origin M3, covered {M4,M2,M1,T4,B4,T1,B1} (cov(2,0) clips)', () => {
        const cells = resolveCells(parsePattern('Pattern-Support-Double-Pickaxe-Range-1'), 'M3');
        expect(positions(cells)).toEqual(new Set(['M3', 'M4', 'M2', 'M1', 'T4', 'B4', 'T1', 'B1']));
        expect(origins(cells)).toEqual(['M3']);
        expect(cells.find((c) => c.position === 'T4')!.role).toBe('covered');
        expect(cells.find((c) => c.position === 'B1')!.role).toBe('covered');
    });

    // Clipping: anchor M4(2,1): cov(+1,0)→(3,1)=off, cov(-1,0)→M3✓, cov(-2,0)→M2✓,
    //   cov(3,0)→(5,1)=off, cov(+2,-1)→(4,0)=off, cov(+1,+1)→(3,2)=off,
    //   cov(-1,-1)→T2(1,0)✓, cov(-2,+1)→B2(0,2)✓.
    it('Support-Double-Pickaxe-Range-1 @ M4 clips multiple off-board cells', () => {
        const cells = resolveCells(parsePattern('Pattern-Support-Double-Pickaxe-Range-1'), 'M4');
        expect(positions(cells)).toEqual(new Set(['M4', 'M3', 'M2', 'T2', 'B2']));
        expect(origins(cells)).toEqual(['M4']);
    });

    // Forward spine tip cov(2,0) lands on-board at a back anchor → spine is contiguous (no gap).
    // Anchor M1(-1,1): ORIGIN M1, cov(+1,0)→M2✓, cov(+2,0)→M3✓, cov(-1,0)/cov(-2,0)→off,
    //   cov(+2,-1)→T2(1,0)✓, cov(+1,+1)→B2(0,2)✓, back-head cells→off.
    it('Support-Double-Pickaxe-Range-1 @ M1 → contiguous spine, covered {M2,M3,T2,B2}', () => {
        const cells = resolveCells(parsePattern('Pattern-Support-Double-Pickaxe-Range-1'), 'M1');
        expect(positions(cells)).toEqual(new Set(['M1', 'M2', 'M3', 'T2', 'B2']));
        expect(origins(cells)).toEqual(['M1']);
    });

    // -----------------------------------------------------------------------
    // Base-Support: same as Base — single origin cell only.
    // -----------------------------------------------------------------------
    it('Base-Support @ M2 → origin M2 only', () => {
        const cells = resolveCells(parsePattern('Pattern-Base-Support'), 'M2');
        expect(cells).toEqual([{ position: 'M2', role: 'origin' }]);
    });
});

const CSV_PATH = 'docs/ship-targeting.csv';

describe('corpus fixture coverage (CI-safe)', () => {
    it('has patterns to test', () => {
        expect(CORPUS_PATTERNS.length).toBeGreaterThan(20);
    });

    it('every corpus pattern resolves: no throw, valid Positions, valid origin count', () => {
        for (const raw of CORPUS_PATTERNS) {
            const parsed = parsePattern(raw);
            const cells = resolveCells(parsed, 'M2');
            for (const c of cells) {
                expect(ALL_POSITIONS, `${raw} -> ${c.position}`).toContain(c.position);
            }
            const originCount = cells.filter((c) => c.role === 'origin').length;
            if (parsed.shape === 'all') {
                expect(originCount, raw).toBe(12);
            } else if (parsed.modifiers.notSelf) {
                // notSelf: caster excluded → 0 origins
                expect(originCount, raw).toBe(0);
            } else {
                // all other patterns (attack and support): exactly 1 origin
                expect(originCount, raw).toBe(1);
            }
        }
    });
});

describe.skipIf(!existsSync(CSV_PATH))('ship-targeting.csv drift check (dev-only)', () => {
    const rows = parseTargetingCsv(readFileSync(CSV_PATH, 'utf8'));
    const livePatterns = new Set<string>();
    for (const r of rows) {
        if (r.activePattern) livePatterns.add(r.activePattern);
        if (r.chargedPattern) livePatterns.add(r.chargedPattern);
    }

    it('all live CSV patterns are present in CORPUS_PATTERNS fixture (update fixture if new patterns added)', () => {
        const fixtureSet = new Set(CORPUS_PATTERNS);
        for (const raw of livePatterns) {
            expect(
                fixtureSet,
                `"${raw}" is in the live CSV but missing from CORPUS_PATTERNS fixture`
            ).toContain(raw);
        }
    });
});
