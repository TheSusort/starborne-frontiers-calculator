import { ParsedPattern } from '../targetingParser';
import { ALL_POSITIONS, positionToAxial } from './board';
import { OFFSET_TABLES, WHOLE_LANE, patternSignature } from './patternOffsets';

// 'caster' marks the casting ship's own cell, shown only for self-excluding (notSelf)
// patterns so the viewer can see where the caster sits relative to the effect.
export type AoeCellRole = 'primary' | 'splash' | 'caster';

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
 * For self-excluding (notSelf) patterns the caster's own cell (0,0) is added as a 'caster'
 * cell so it can be shown as a neutral marker even though it isn't affected.
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
    const cells: PatternCell[] = offsets.map((o) => ({
        q: o.dq,
        r: o.dr,
        role: o.role === 'origin' ? ('primary' as const) : ('splash' as const),
    }));

    // notSelf patterns exclude the caster from the effect — mark its cell so it renders gray.
    if (pattern.modifiers.notSelf) {
        cells.unshift({ q: 0, r: 0, role: 'caster' });
    }
    return cells;
}
