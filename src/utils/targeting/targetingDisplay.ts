import { Position } from '../../types/encounters';
import { ParsedPattern, ParsedTarget, SkillTargeting } from '../targetingParser';
import { ALL_POSITIONS } from './board';
import { resolveCells } from './resolvePattern';

// Center-front bias so footprints frame like the prototype; also the deterministic
// tie-break when several anchors clip equally little.
const ANCHOR_PREFERENCE: Position[] = [
    'M3',
    'M4',
    'M2',
    'M1',
    'T3',
    'T4',
    'T2',
    'T1',
    'B3',
    'B4',
    'B2',
    'B1',
];

/**
 * Pick the board cell to anchor a footprint preview on: the anchor that leaves the
 * most cells on-board (resolveCells clips off-board cells), tie-broken by ANCHOR_PREFERENCE.
 * Pure. Throws only if resolveCells throws (unknown pattern signature) — callers guard.
 */
export function pickDisplayAnchor(pattern: ParsedPattern): Position {
    let best: Position = ANCHOR_PREFERENCE[0];
    let bestCount = -1;
    let bestRank = Infinity;
    for (const anchor of ALL_POSITIONS) {
        const count = resolveCells(pattern, anchor).length;
        const rank = ANCHOR_PREFERENCE.indexOf(anchor);
        if (count > bestCount || (count === bestCount && rank < bestRank)) {
            best = anchor;
            bestCount = count;
            bestRank = rank;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// targetingLabel — human-readable caption
// ---------------------------------------------------------------------------

function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function shapeSegment(p: ParsedPattern): string {
    if (p.shape === 'base') return 'Single target';
    if (p.shape === 'all') return 'Whole board';
    const prefixes = [
        p.modifiers.reverse && 'Reverse',
        p.modifiers.prolonged && 'Prolonged',
        p.modifiers.double && 'Double',
    ].filter(Boolean);
    const suffixes = [
        p.modifiers.fromCentre && 'from centre',
        p.modifiers.notSelf && 'not self',
        p.modifiers.anchorMod && `(${p.modifiers.anchorMod})`,
    ].filter(Boolean);
    return [...prefixes, cap(p.shape), ...suffixes].join(' ');
}

function rangeSegment(p: ParsedPattern): string | null {
    if (p.shape === 'all' || p.range === 'all') return null; // covered by shapeSegment
    if (p.range === 'lane') return 'Whole lane';
    if (typeof p.range === 'number' && p.range >= 1) return `Range ${p.range}`;
    return null; // range 0 → omit
}

function targetSegment(t: ParsedTarget): string {
    return `${t.side} ${t.selection}`;
}

/** Human-readable one-line caption for a skill's targeting, e.g. "Cone · Range 1 · enemy front". */
export function targetingLabel({ pattern, target }: SkillTargeting): string {
    return [shapeSegment(pattern), rangeSegment(pattern), targetSegment(target)]
        .filter(Boolean)
        .join(' · ');
}
