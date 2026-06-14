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
        expect(pickDisplayAnchor(pattern)).toBe(pickDisplayAnchor(pattern));
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
});
