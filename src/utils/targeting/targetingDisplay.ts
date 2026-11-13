import { ParsedPattern, ParsedTarget, SkillTargeting } from '../targetingParser';

// ---------------------------------------------------------------------------
// targetingLabel — human-readable caption (used for the footprint's aria-label)
// ---------------------------------------------------------------------------

function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// 'support' is intentionally omitted from the caption — the ally target side already
// conveys it (see spec caption rules). Do NOT add a "Support" prefix here.
function shapeSegment(p: ParsedPattern): string {
    if (p.shape === 'base') return 'Single target';
    if (p.shape === 'all') return 'Whole board';
    if (p.shape === 'row') return 'Whole row';
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
    if (t.selection === 'row-most') return `${t.side} row with the most units`;
    if (t.selection === 'row-least') return `${t.side} row with the fewest units`;
    if (t.selection === 'marked') return `every Marked ${t.side}, else ${t.side} front`;
    return `${t.side} ${t.selection}`;
}

/** Human-readable one-line caption for a skill's targeting, e.g. "Cone · Range 1 · enemy front". */
export function targetingLabel({ pattern, target }: SkillTargeting): string {
    return [shapeSegment(pattern), rangeSegment(pattern), targetSegment(target)]
        .filter(Boolean)
        .join(' · ');
}
