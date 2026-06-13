import { ParsedPattern } from '../targetingParser';

export type CellRole = 'origin' | 'covered';

/** A covered/origin cell as an axial offset from the origin (0,0).
 *  Offsets use the same axial deltas as DIRECTIONS in ./board (depth toward back = (-1,0)). */
export interface OffsetCell {
    dq: number;
    dr: number;
    role: CellRole;
}

const ORIGIN: OffsetCell = { dq: 0, dr: 0, role: 'origin' };

/** Shorthand for a covered (non-origin) offset cell — keeps offset tables scannable. */
export const cov = (dq: number, dr: number): OffsetCell => ({ dq, dr, role: 'covered' });

/** Support whole-lane (Pattern-Line-Support-whole-lane): caster-centered line,
 *  2 forward (+q) + caster + 2 back (-q), clipped to the board. Selected by
 *  range === 'lane' in resolvePattern, not by signature. */
export const WHOLE_LANE: OffsetCell[] = [cov(2, 0), cov(1, 0), ORIGIN, cov(-1, 0), cov(-2, 0)];

/** Build a stable signature for a pattern from its parsed form. `shape` and `range`
 *  both participate (whole-lane is shape 'line' + range 'lane'); modifiers are appended
 *  in a fixed order. The 'all' and 'lane' special cases are handled in resolvePattern
 *  BEFORE this lookup, so they need no table entry here. */
export function patternSignature(p: ParsedPattern): string {
    const m = p.modifiers;
    const mods = [
        m.support && 'support',
        m.prolonged && 'prolonged',
        m.reverse && 'reverse',
        m.notSelf && 'notSelf',
        m.fromCentre && 'fromCentre',
        m.double && 'double',
        m.anchorMod && `anchor:${m.anchorMod}`,
    ]
        .filter(Boolean)
        .join('+');
    return `${p.shape}|${p.range}|${mods}`;
}

/** Per-signature offset tables, hand-derived from the in-game pattern PNGs.
 *  Each table includes exactly one ORIGIN (except not-self patterns, which omit it).
 *  Tasks 3-7 fill this in shape-family by shape-family. */
export const OFFSET_TABLES: Record<string, OffsetCell[]> = {
    // Pattern-Base -> shape 'base', range 0, no mods
    'base|0|': [ORIGIN],
    // Pattern-Range-3 -> shape 'range', range 3: origin + 3 steps toward back
    'range|3|': [ORIGIN, cov(-1, 0), cov(-2, 0), cov(-3, 0)],

    // ---------------------------------------------------------------------------
    // Line family (Task 3)
    //
    // Convention: attacker-on-left in PNGs; rightward = deeper into enemy = back
    // direction = (-1,0).  Support patterns use the same rightward direction (they
    // buff allies who are further from the caster, i.e. deeper toward the enemy).
    // ---------------------------------------------------------------------------

    // Pattern-Line-Range-1: bright-red origin (left) + 1 dark-red covered (right).
    // PNG: 2 hexes in a row.  Covered extends 1 step back (-1,0).
    'line|1|': [ORIGIN, cov(-1, 0)],

    // Pattern-Line-Range-2: bright-red origin (left) + 2 dark-red covered (right).
    // PNG: 3 hexes in a row.  Covered extends 2 steps back.
    'line|2|': [ORIGIN, cov(-1, 0), cov(-2, 0)],

    // Pattern-Line-Range-3: Pattern-Range-3.png — confirmed as origin + 3 steps back.
    'line|3|': [ORIGIN, cov(-1, 0), cov(-2, 0), cov(-3, 0)],

    // Pattern-Line-from-centre-Range-1: 3 bright-red hexes in a row; origin is the
    // middle cell (fromCentre), one covered step toward back (-1,0) and one toward
    // front (+1,0).
    // PNG: 3 hexes in a row, all vivid red.
    'line|1|fromCentre': [ORIGIN, cov(-1, 0), cov(1, 0)],

    // Pattern-Line-Support-Range-1: support extends FORWARD (+q) from caster; caster NOT included.
    // 1 covered cell one step forward from caster.  No origin (support, 0 origins).
    'line|1|support': [cov(1, 0)],

    // Pattern-Line-Support-Range-2: grey caster icon + 2 yellow hexes.
    // Origin = nearest yellow; covered = 1 step further back (-1,0).
    // PNG: caster icon left + 2 yellow hexes.
    'line|2|support': [ORIGIN, cov(-1, 0)],

    // Pattern-Line-Support-Range-3: support extends FORWARD (+q) from caster; caster NOT included.
    // 3 covered cells extending forward.  No origin (support, 0 origins).
    'line|3|support': [cov(1, 0), cov(2, 0), cov(3, 0)],

    // Pattern-Line-Support-Not-Self-Range-2: range-2 support extending FORWARD, caster excluded (notSelf).
    // Two covered cells extending forward from caster.  No origin.
    'line|2|support+notSelf': [cov(1, 0), cov(2, 0)],

    // ---------------------------------------------------------------------------
    // Cone family (Task 4)
    //
    // PNG reading convention (confirmed by pixel analysis):
    //   • Image LEFT = enemy FRONT (high q, nearest caster); RIGHT = BACK (low q, deep enemy).
    //   • DARK hex = ORIGIN (the anchor/tip cell); BRIGHT hexes = covered cells.
    //   • M row is left-shifted ~9 px relative to T/B rows.  T(q) and B(q-1) both sit at
    //     pixel_x ≈ midpoint(M(q), M(q-1)), i.e. +9–10 px to the right of M(q).
    //
    // Standard backward cone: tip (ORIGIN) at FRONT, fans into 3 back cells:
    //   M-back(-1,0), T-upback(0,-1), B-downback(-1,+1).
    // Standard forward (reverse) cone: tip at BACK, fans into 3 front cells:
    //   M-front(+1,0), T-upfront(+1,-1), B-downfront(0,+1).
    // ---------------------------------------------------------------------------

    // Pattern-Cone-Range-1
    // PNG: 4 hexes — dark origin at leftmost-middle (FRONT) + 3 bright covered cells
    //   fanning back: M-back(-1,0), T-upback(0,-1), B-downback(-1,+1).
    // Verified @ M4: origin M4, covered {M3, T3, B3}.
    'cone|1|': [ORIGIN, cov(-1, 0), cov(0, -1), cov(-1, 1)],

    // Pattern-Cone-Back-Range-1  (anchor:back — ORIGIN sits at the BACK end)
    // PNG: 6 hexes — dark origin at rightmost-middle (BACK) + 5 bright covered cells
    //   forming a 2-layer wide forward fan.
    //   Layer 1 (single-step): M-front(+1,0), T-upfront(+1,-1), B-downfront(0,+1).
    //   Layer 2 (2-step axial offsets, clipped on-board): T-further(+2,-1), B-further(+1,+1).
    // Verified @ M2: origin M2, covered {M3, T2, B2, T3, B3}.
    'cone|1|anchor:back': [ORIGIN, cov(1, 0), cov(1, -1), cov(0, 1), cov(2, -1), cov(1, 1)],

    // Pattern-Cone-Support-Range-1: support extends FORWARD (+q); caster NOT included.
    // 3 covered cells: forward-M (+1,0), up-forward (+1,-1), down-forward (0,+1).  No origin.
    'cone|1|support': [cov(1, -1), cov(1, 0), cov(0, 1)],

    // Pattern-Prolonged_Cone-Support-Range-2: support extends FORWARD (+q); caster NOT included.
    // 4 covered cells: forward-M (+1,0), 2-steps-forward-M (+2,0), up-forward (+1,-1), down-forward (0,+1).
    // No origin (support, 0 origins).
    'cone|2|support+prolonged': [cov(1, -1), cov(1, 0), cov(2, 0), cov(0, 1)],

    // Pattern-Prolonged_Cone-Support-Center-Range-2 (anchor:center variant):
    // Human-verified: 4 covered cells offset from caster center: up-back (0,-1), back (-1,0),
    // forward (+1,0), down-back (-1,+1).  No origin (support, 0 origins).
    'cone|2|support+prolonged+anchor:center': [cov(0, -1), cov(-1, 0), cov(1, 0), cov(-1, 1)],

    // Pattern-Reverse-Cone-Range-1
    // PNG: 4 hexes — dark origin at rightmost-middle (BACK) + 3 bright covered cells
    //   fanning forward (mirror of Cone-Range-1): M-front(+1,0), T-upfront(+1,-1),
    //   B-downfront(0,+1).
    // Verified @ M3: origin M3, covered {M4, T3, B3}.
    'cone|1|reverse': [ORIGIN, cov(1, 0), cov(1, -1), cov(0, 1)],

    // ---------------------------------------------------------------------------
    // Circle family (Task 5)
    //
    // Convention: bright center = ORIGIN; surrounding 6 darker hexes = covered.
    // A circle is the full ring — origin + all 6 neighbor directions.
    // ---------------------------------------------------------------------------

    // Pattern-Circle-Range-1
    // PNG: 7 hexes — bright-red center origin + 6 darker-red neighbors forming a full ring.
    // Directions from origin: back(-1,0), front(+1,0), up-back(0,-1), up-front(+1,-1),
    //   down-back(-1,+1), down-front(0,+1).
    // Verified @ M3(q=1,r=1): origin M3, covered {M2, M4, T2, T3, B2, B3}.
    'circle|1|': [ORIGIN, cov(-1, 0), cov(1, 0), cov(0, -1), cov(1, -1), cov(-1, 1), cov(0, 1)],

    // Pattern-Circle-Support-Range-1
    // PNG: 7 hexes — bright-yellow center origin + 6 darker-yellow neighbors (support variant).
    // Same geometry as circle|1|, yellow = support (allies).
    // Verified @ M3(q=1,r=1): origin M3, covered {M2, M4, T2, T3, B2, B3}.
    'circle|1|support': [
        ORIGIN,
        cov(-1, 0),
        cov(1, 0),
        cov(0, -1),
        cov(1, -1),
        cov(-1, 1),
        cov(0, 1),
    ],

    // ---------------------------------------------------------------------------
    // Backline family (Task 5)
    //
    // Convention: ORIGIN is the BACK (deep enemy) cell; splash extends FORWARD (+q).
    // "backline" patterns target the back of the enemy formation and splash toward front.
    // Image orientation: back = right (bright origin), forward = left (darker covered).
    // ---------------------------------------------------------------------------

    // Pattern-Backline-Range-1
    // PNG: 2 hexes in a row — bright-red origin (right/back) + 1 darker covered step forward.
    // Covered: M-front(+1,0).
    // Verified @ M1(q=-1,r=1): origin M1, covered M2.
    'backline|1|': [ORIGIN, cov(1, 0)],

    // Pattern-Backline-Range-2
    // PNG: 3 hexes in a row — bright-red origin (right/back) + 2 darker covered steps forward.
    // Covered: M-front(+1,0), M-2front(+2,0).
    // Verified @ M1(q=-1,r=1): origin M1, covered {M2, M3}.
    'backline|2|': [ORIGIN, cov(1, 0), cov(2, 0)],

    // ---------------------------------------------------------------------------
    // Cross family (Task 6)
    //
    // Convention: DARK center hex = ORIGIN; BRIGHT hexes = covered.
    // A cross is the 4 diagonal (off-row) neighbors: up-back, up-front, down-back, down-front.
    // It excludes the 2 in-row directions (back, front) — giving a rotated + shape.
    // ---------------------------------------------------------------------------

    // Pattern-Cross-Range-1
    // PNG: 5 hexes — dark-red center origin (M row) + 2 bright T cells + 2 bright B cells.
    // T bright at c=10 (up-front, delta=-9 from M origin at c=19) and c=30 (up-back, delta=+11).
    // B bright at c=10 (down-front, delta=-9) and c=30 (down-back, delta=+11).
    // Offsets: up-back(0,-1), up-front(+1,-1), down-back(-1,+1), down-front(0,+1).
    // Verified @ M3(q=1,r=1): origin M3, covered {T2(0,-1), T3(+1,-1), B2(-1,+1), B3(0,+1)}.
    'cross|1|': [ORIGIN, cov(0, -1), cov(1, -1), cov(-1, 1), cov(0, 1)],

    // ---------------------------------------------------------------------------
    // Curve family (Task 6)
    //
    // Convention: DARK center hex = ORIGIN (M row); BRIGHT hexes = covered.
    // Curve = origin + T-back + B-back: origin flanked by both backward diagonals.
    // Reverse-Curve mirrors this: origin + T-front + B-front.
    // ---------------------------------------------------------------------------

    // Pattern-Curve-Range-1
    // PNG: 3 hexes — dark-red M origin (LEFT/FRONT, c=11) + 1 bright T hex (BACK, c=20) +
    //   1 bright B hex (BACK, c=20).  T and B both appear to the BACK-RIGHT of origin.
    // T covered at c=20: delta=+9 from origin c=11 → up-back(0,-1) ✓
    // B covered at c=20: delta=+9 → down-back(-1,+1) ✓
    // Verified @ M4(q=2,r=1): origin M4, covered {T3(0,-1)=T3, B3(-1,+1)=B3}.
    'curve|1|': [ORIGIN, cov(0, -1), cov(-1, 1)],

    // Pattern-Reverse-Curve-Range-1
    // PNG: 3 hexes — dark-red M origin (RIGHT/BACK, c=20) + 1 bright T hex (FRONT, c=11) +
    //   1 bright B hex (FRONT, c=11).  T and B appear to the FRONT-LEFT of origin.
    // T covered at c=11: delta=-9 from origin c=20 → up-front(+1,-1) ✓
    // B covered at c=11: delta=-9 → down-front(0,+1) ✓
    // Verified @ M3(q=1,r=1): origin M3, covered {T4(+1,-1)=T4... wait}
    // Actually at M3: up-front(+1,-1) → T(q+1=2,r=0)=T3. down-front(0,+1) → B(q=1,r=2)=B3.
    // Verified @ M3(q=1,r=1): origin M3, covered {T3(+1,-1), B3(0,+1)}.
    'curve|1|reverse': [ORIGIN, cov(1, -1), cov(0, 1)],

    // ---------------------------------------------------------------------------
    // Root family (Task 6)
    //
    // Convention: BRIGHT center hex = ORIGIN (M row, BACK side of pattern); darker cells = covered.
    // Root = origin at back M + M-front (covered, dark) + T-up-back + B-down-back.
    // The T and B covered cells are directly adjacent to the origin (not to M-front).
    // This follows the same image convention as Backline (bright = origin).
    // ---------------------------------------------------------------------------

    // Pattern-Root-Range-1
    // Human-verified: origin at FRONT-M (bright cell), two T/B diagonal back cells, plus M-back.
    // Offsets: back(-1,0), T-back(-1,-1), B-back(-2,+1).
    // Verified @ M4(q=2,r=1): origin M4, covered {M3(-1,0), T2(-1,-1), B2(-2,+1)}.
    'root|1|': [ORIGIN, cov(-1, 0), cov(-1, -1), cov(-2, 1)],

    // ---------------------------------------------------------------------------
    // Split family (Task 7)
    //
    // PNG orientation: LEFT = FRONT (high q), RIGHT = BACK (low q).
    // ORIGIN = DARK hex (min brightness) at front-M; covered cells extend into the
    // two T/B rows and M-spine going toward back.
    //
    // Pattern-Split-Range-1:
    //   3 hexes — dark origin at FRONT-M + T-back(-1,-1) + B-back(-2,+1).
    //   Shape: origin + two diagonal back tines (no M-spine).
    //   Human-verified @ M4(2,1): origin M4, covered {T2(-1,-1), B2(-2,+1)}.
    'split|1|': [ORIGIN, cov(-1, -1), cov(-2, 1)],

    // ---------------------------------------------------------------------------
    // Burst family (Task 7)
    //
    // Pattern-Burst-Range-1:
    //   6 hexes — dark origin at FRONT-M + M-back2(-2,0) + T at origin column (0,-1) +
    //   T at back column (-1,-1) + B at back column (-1,+1) + B at back2 column (-2,+1).
    //   Human-verified @ M4(2,1): origin M4, covered {M2(-2,0), T3(0,-1), T2(-1,-1), B3(-1,+1), B2(-2,+1)}.
    'burst|1|': [ORIGIN, cov(-1, -1), cov(0, -1), cov(-2, 0), cov(-2, 1), cov(-1, 1)],

    // ---------------------------------------------------------------------------
    // Scattershot family (Task 7)
    //
    // Pattern-Scattershot-Range-1:
    //   4 hexes — origin at FRONT-M + M-back2(-2,0) + T-back(-1,-1) + B-back2(-2,+1).
    //   Human-verified @ M4(2,1): origin M4, covered {M2(-2,0), T2(-1,-1), B2(-2,+1)}.
    'scattershot|1|': [ORIGIN, cov(-1, -1), cov(-2, 0), cov(-2, 1)],

    // ---------------------------------------------------------------------------
    // Wings family (Task 7)
    //
    // Wings-Range-1: all-T+B diagonal neighbors of origin M (same geometry as cross|1|).
    // Origin at center-M (darkest cell), 2 T cells + 2 B cells flanking it diagonally.
    //   Verified @ M3(1,1): origin M3, covered {T2(0,-1), T3(+1,-1), B2(-1,+1), B3(0,+1)}.
    'wings|1|': [ORIGIN, cov(0, -1), cov(1, -1), cov(-1, 1), cov(0, 1)],

    // Wings-Range-2: extends each wing arm by one more step back.
    //   T-row: adds T1(-1,-1) to the back of the upper wing.
    //   B-row: adds B1(-2,+1) to the back of the lower wing.
    //   Total 7 cells: origin M + T3(+1,-1) + T2(0,-1) + T1(-1,-1) + B3(0,+1) + B2(-1,+1) + B1(-2,+1).
    //   Verified @ M4(2,1): origin M4, covered {T4(+1,-1), T3(0,-1), T2(-1,-1), B4(0,+1), B3(-1,+1), B2(-2,+1)}.
    'wings|2|': [ORIGIN, cov(1, -1), cov(0, -1), cov(-1, -1), cov(0, 1), cov(-1, 1), cov(-2, 1)],

    // Wings-Range-2-Support-Not-Self: support variant (buffs allies), caster excluded (notSelf).
    // DONE_WITH_CONCERNS: verified vs Pattern-Wings-Range-2.png — same cell footprint as wings|2|
    // with ORIGIN removed (notSelf → zero origins).  Support geometry matches attack wings PNG.
    'wings|2|support+notSelf': [
        cov(1, -1),
        cov(0, -1),
        cov(-1, -1),
        cov(0, 1),
        cov(-1, 1),
        cov(-2, 1),
    ],

    // ---------------------------------------------------------------------------
    // Circle-forward family (Task 7)
    //
    // Pattern-Support-Forward-Circle-Range-1:
    //   6 hexes — anchor:forward places ORIGIN at FRONT-M; covered = T at origin column (0,-1),
    //   T at back column (-1,-1), M-back (-1,0), B at back column (-1,+1), B at back2 column (-2,+1).
    //   Human-verified @ M4(2,1): origin M4, covered {T3(0,-1), T2(-1,-1), M3(-1,0), B3(-1,+1), B2(-2,+1)}.
    'circle|1|support+anchor:forward': [
        ORIGIN,
        cov(-1, -1),
        cov(0, -1),
        cov(-1, 0),
        cov(-2, 1),
        cov(-1, 1),
    ],

    // ---------------------------------------------------------------------------
    // Pickaxe-double family (Task 7)
    //
    // "Double pickaxe" = two T/B heads (one at each end of the M-spine) + full M-spine.
    // Support variant — ORIGIN is the brightest cell = center M cell.
    //
    // Pattern-Support-Double-Pickaxe-Range-0:
    //   7 hexes — origin at M3(1,1) [center of M4,M3,M2 spine]:
    //     M4(+1,0), M2(-1,0) extend spine by 1 each direction.
    //     Front head: T4(+2,-1) + B4(+1,+1) [adjacent to M4, outside the board-far end].
    //     Back head:  T1(-1,-1) + B1(-2,+1) [adjacent to M2, at back-far end].
    //   Verified @ M3(1,1): spine {M4, M2}, front-head {T4(+2,-1), B4(+1,+1)},
    //     back-head {T1(-1,-1), B1(-2,+1)}.
    'pickaxe|0|support+double': [
        ORIGIN,
        cov(1, 0),
        cov(-1, 0),
        cov(2, -1),
        cov(1, 1),
        cov(-1, -1),
        cov(-2, 1),
    ],

    // Pattern-Support-Double-Pickaxe-Range-1:
    //   Derived from pickaxe|0|support+double by extending the M-spine one step back
    //   (cov(-2,0) = M1) and one further step forward (cov(3,0), clips off-board at M3 anchor).
    //   Verified vs Pattern-Support-Double-Pickaxe-Range-1.png.
    //   9-cell table (cov(3,0) clips at most anchors): origin center-M + 4-cell spine +
    //     front-head {T(+2,-1), B(+1,+1)} + back-head {T(-1,-1), B(-2,+1)} + off-board forward.
    //   Verified @ M3(1,1): {M3(origin), M4, M2, M1, T4(+2,-1), B4(+1,+1), T1(-1,-1), B1(-2,+1)};
    //     cov(3,0)→(4,1) clips off-board.
    'pickaxe|1|support+double': [
        ORIGIN,
        cov(1, 0),
        cov(-1, 0),
        cov(-2, 0),
        cov(3, 0),
        cov(2, -1),
        cov(1, 1),
        cov(-1, -1),
        cov(-2, 1),
    ],

    // ---------------------------------------------------------------------------
    // Base-Support (Task 7)
    //
    // Pattern-Base-Support: same single-cell shape as base|0| — just the origin.
    // No PNG needed; identical footprint to 'base|0|'.
    'base|0|support': [ORIGIN],
};
