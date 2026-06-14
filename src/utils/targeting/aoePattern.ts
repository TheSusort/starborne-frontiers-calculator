import { ParsedPattern } from '../targetingParser';
import { ALL_POSITIONS, positionToAxial } from './board';
import { OFFSET_TABLES, WHOLE_LANE, patternSignature } from './patternOffsets';

export type AoeCellRole = 'primary' | 'splash';

/** A single AoE cell in axial coordinates relative to the primary target (0,0). */
export interface PatternCell {
    q: number;
    r: number;
    role: AoeCellRole;
}

/**
 * Convert a parsed pattern into its relative AoE footprint: a list of axial cells with the
 * primary target at (0,0) and splash cells offset around it. Built from the per-signature
 * offset tables (origin → 'primary', covered → 'splash'). Throws for an unknown signature —
 * callers guard and render nothing.
 *
 * Special cases: whole-lane patterns use the caster-centred lane; 'all' (whole board) has no
 * relative footprint, so it returns every formation cell as primary to convey "hits all".
 */
export function toPatternCells(pattern: ParsedPattern): PatternCell[] {
    if (pattern.shape === 'all') {
        return ALL_POSITIONS.map((pos) => {
            const { q, r } = positionToAxial(pos);
            return { q, r, role: 'primary' as const };
        });
    }

    const offsets =
        pattern.range === 'lane' ? WHOLE_LANE : OFFSET_TABLES[patternSignature(pattern)];
    if (!offsets) {
        throw new Error(
            `No offset table for pattern signature: "${patternSignature(pattern)}" (${pattern.raw})`
        );
    }
    return offsets.map((o) => ({
        q: o.dq,
        r: o.dr,
        role: o.role === 'origin' ? ('primary' as const) : ('splash' as const),
    }));
}
