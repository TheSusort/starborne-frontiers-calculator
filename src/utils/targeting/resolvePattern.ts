import { Position } from '../../types/encounters';
import { ParsedPattern } from '../targetingParser';
import { ALL_POSITIONS, axialToPosition, positionToAxial } from './board';
import { CellRole, OFFSET_TABLES, OffsetCell, patternSignature } from './patternOffsets';

export type { CellRole } from './patternOffsets';
export interface ResolvedCell {
    position: Position;
    role: CellRole;
}

// whole-lane: caster-centered line, 2 forward (+q) + caster + 2 back (-q), clipped.
const WHOLE_LANE: OffsetCell[] = [
    { dq: 2, dr: 0, role: 'covered' },
    { dq: 1, dr: 0, role: 'covered' },
    { dq: 0, dr: 0, role: 'origin' },
    { dq: -1, dr: 0, role: 'covered' },
    { dq: -2, dr: 0, role: 'covered' },
];

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
    const table = OFFSET_TABLES[patternSignature(pattern)];
    if (!table) {
        throw new Error(
            `No offset table for pattern signature: "${patternSignature(pattern)}" (${pattern.raw})`
        );
    }
    return stamp(table, anchor);
}
