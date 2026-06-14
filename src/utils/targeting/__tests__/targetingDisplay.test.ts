import { describe, it, expect } from 'vitest';
import { pickDisplayAnchor, targetingLabel } from '../targetingDisplay';
import { parseShipTargeting } from '../../targetingParser';
import { resolveCells } from '../resolvePattern';
import { OFFSET_TABLES, patternSignature } from '../patternOffsets';

function activePattern(pattern: string) {
    return parseShipTargeting({ activeTarget: 'front', activePattern: pattern }).active!.pattern;
}

describe('pickDisplayAnchor', () => {
    it('returns an anchor whose footprint is fully on-board for a standard cone', () => {
        const pattern = activePattern('Pattern-Cone-Range-1');
        const anchor = pickDisplayAnchor(pattern);
        const expected = OFFSET_TABLES[patternSignature(pattern)].length;
        expect(resolveCells(pattern, anchor).length).toBe(expected); // nothing clipped
    });

    it('returns an anchor whose footprint is fully on-board for a backline pattern', () => {
        const pattern = activePattern('Pattern-Backline-Range-2');
        const anchor = pickDisplayAnchor(pattern);
        const expected = OFFSET_TABLES[patternSignature(pattern)].length;
        expect(resolveCells(pattern, anchor).length).toBe(expected);
    });

    it('is deterministic (tie-break) for whole-board "all" patterns', () => {
        const pattern = activePattern('Pattern-All'); // resolves 12 cells from any anchor
        // All anchors tie on count; ANCHOR_PREFERENCE center-front bias picks M3.
        expect(pickDisplayAnchor(pattern)).toBe('M3');
        expect(resolveCells(pattern, pickDisplayAnchor(pattern)).length).toBe(12);
    });
});

function active(target: string, pattern: string) {
    return parseShipTargeting({ activeTarget: target, activePattern: pattern }).active!;
}

describe('targetingLabel', () => {
    it('labels a ranged cone', () => {
        expect(targetingLabel(active('front', 'Pattern-Cone-Range-1'))).toBe(
            'Cone · Range 1 · enemy front'
        );
    });
    it('omits range for single-target base patterns', () => {
        const label = targetingLabel(active('front', 'Pattern-Base'));
        expect(label).toBe('Single target · enemy front');
        expect(label).not.toContain('Range');
    });

    it('whole-board "all" pattern has no Range segment', () => {
        // Pattern-All → shape 'all', range 'all'; rangeSegment returns null for shape==='all'
        const label = targetingLabel(active('front', 'Pattern-All'));
        expect(label).toBe('Whole board · enemy front');
        expect(label).not.toContain('Range');
    });

    it('whole-lane support pattern shows "Whole lane" and no Range segment', () => {
        // Pattern-Line-Support-whole-lane → shape 'line', range 'lane', modifiers.support=true
        // support modifier is intentionally omitted from the caption (ally target side conveys it)
        const label = targetingLabel(active('allies', 'Pattern-Line-Support-whole-lane'));
        expect(label).toBe('Line · Whole lane · ally team');
        expect(label).toContain('Whole lane');
        expect(label).not.toContain('Range');
    });

    it('reverse modifier appears as prefix before shape name', () => {
        // Pattern-Reverse-Cone-Range-1 → shape 'cone', range 1, modifiers.reverse=true
        const label = targetingLabel(active('front', 'Pattern-Reverse-Cone-Range-1'));
        expect(label).toBe('Reverse Cone · Range 1 · enemy front');
        expect(label.startsWith('Reverse ')).toBe(true);
    });
});
