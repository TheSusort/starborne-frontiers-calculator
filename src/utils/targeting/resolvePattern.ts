import { Position } from '../../types/encounters';
import { ParsedPattern } from '../targetingParser';
import { ALL_POSITIONS, axialToPosition, positionToAxial } from './board';
import {
    CellRole,
    OFFSET_TABLES,
    OffsetCell,
    patternSignature,
    WHOLE_LANE,
} from './patternOffsets';

export type { CellRole } from './patternOffsets';
export interface ResolvedCell {
    position: Position;
    role: CellRole;
}

function stamp(table: OffsetCell[], anchor: Position): ResolvedCell[] {
    const a = positionToAxial(anchor);
    const out: ResolvedCell[] = [];
    for (const { dq, dr, role } of table) {
        const pos = axialToPosition(a.q + dq, a.r + dr);
        if (pos) out.push({ position: pos, role });
    }
    return out;
}

export function resolveCells(pattern: ParsedPattern, anchor: Position): ResolvedCell[] {
    // Special case: whole-team patterns ignore geometry.
    if (pattern.shape === 'all') {
        return ALL_POSITIONS.map((position) => ({ position, role: 'origin' as const }));
    }
    // Special case: support whole-lane (range 'lane') is a caster-centered line.
    if (pattern.range === 'lane') {
        return stamp(WHOLE_LANE, anchor);
    }
    const sig = patternSignature(pattern);
    const table = OFFSET_TABLES[sig];
    if (!table) {
        throw new Error(`No offset table for pattern signature: "${sig}" (${pattern.raw})`);
    }
    return stamp(table, anchor);
}
