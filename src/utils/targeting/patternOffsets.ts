import { ParsedPattern } from '../targetingParser';

export type CellRole = 'origin' | 'covered';

/** A covered/origin cell expressed as an axial offset from the origin (0,0).
 *  Offsets are in board-axial space; see the plan's direction table. */
export interface OffsetCell {
    dq: number;
    dr: number;
    role: CellRole;
}

const ORIGIN: OffsetCell = { dq: 0, dr: 0, role: 'origin' };

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
    'range|3|': [
        ORIGIN,
        { dq: -1, dr: 0, role: 'covered' },
        { dq: -2, dr: 0, role: 'covered' },
        { dq: -3, dr: 0, role: 'covered' },
    ],
};
