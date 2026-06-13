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

    // Pattern-Line-Range-3: no PNG — derived by extending the Range-1/2 progression.
    // TODO verify vs PNG
    'line|3|': [ORIGIN, cov(-1, 0), cov(-2, 0), cov(-3, 0)],

    // Pattern-Line-from-centre-Range-1: 3 bright-red hexes in a row; origin is the
    // middle cell (fromCentre), one covered step toward back (-1,0) and one toward
    // front (+1,0).
    // PNG: 3 hexes in a row, all vivid red.
    'line|1|fromCentre': [ORIGIN, cov(-1, 0), cov(1, 0)],

    // Pattern-Line-Support-Range-1: grey caster icon (not a cell) + 1 bright-yellow
    // hex = origin only.  Range-1 support = the single target cell.
    // PNG: caster icon left + 1 yellow hex.
    'line|1|support': [ORIGIN],

    // Pattern-Line-Support-Range-2: grey caster icon + 2 yellow hexes.
    // Origin = nearest yellow; covered = 1 step further back (-1,0).
    // PNG: caster icon left + 2 yellow hexes.
    'line|2|support': [ORIGIN, cov(-1, 0)],

    // Pattern-Line-Support-Range-3: grey caster icon + 3 yellow hexes.
    // Origin = nearest yellow; covered = 2 further steps back.
    // PNG: caster icon left + 3 yellow hexes.
    'line|3|support': [ORIGIN, cov(-1, 0), cov(-2, 0)],

    // Pattern-Line-Support-Not-Self-Range-2: range-2 reach beyond the caster, caster excluded
    // (notSelf). Two covered cells extending deeper toward back; no origin.
    'line|2|support+notSelf': [cov(-1, 0), cov(-2, 0)],

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

    // Pattern-Cone-Support-Range-1
    // PNG: single bright-yellow hex = origin only (support point-target, no area splash).
    'cone|1|support': [ORIGIN],

    // Pattern-Prolonged_Cone-Support-Range-2
    // PNG: 5 yellow hexes — brighter origin at leftmost-middle (FRONT) + 4 covered:
    //   2-step back line in M-row (-1,0) and (-2,0), plus T-upback(0,-1) and
    //   B-downback(-1,+1) at origin's column.  "Prolonged" extends back reach one step.
    // Verified @ M4: origin M4, covered {M3, M2, T3, B3}.
    'cone|2|support+prolonged': [ORIGIN, cov(-1, 0), cov(-2, 0), cov(0, -1), cov(-1, 1)],

    // Pattern-Prolonged_Cone-Support-Center-Range-2  (PNG MISSING — not found in assets)
    // DONE_WITH_CONCERNS: derived from cone|2|support+prolonged by applying anchor:center.
    // "Center" likely positions the origin at a center M cell rather than the front edge,
    // but without the PNG this cannot be verified.  Using the same footprint as the
    // non-center variant as a placeholder until the PNG is located.
    'cone|2|support+prolonged+anchor:center': [
        ORIGIN,
        cov(-1, 0),
        cov(-2, 0),
        cov(0, -1),
        cov(-1, 1),
    ],

    // Pattern-Reverse-Cone-Range-1
    // PNG: 4 hexes — dark origin at rightmost-middle (BACK) + 3 bright covered cells
    //   fanning forward (mirror of Cone-Range-1): M-front(+1,0), T-upfront(+1,-1),
    //   B-downfront(0,+1).
    // Verified @ M3: origin M3, covered {M4, T3, B3}.
    'cone|1|reverse': [ORIGIN, cov(1, 0), cov(1, -1), cov(0, 1)],
};
