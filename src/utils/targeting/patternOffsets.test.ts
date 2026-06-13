import { describe, it, expect } from 'vitest';
import { OFFSET_TABLES, WHOLE_LANE, OffsetCell } from './patternOffsets';

const originCount = (t: OffsetCell[]) => t.filter((c) => c.role === 'origin').length;
const hasDupes = (t: OffsetCell[]) => {
    const seen = new Set(t.map((c) => `${c.dq},${c.dr}`));
    return seen.size !== t.length;
};

describe('OFFSET_TABLES structural invariants', () => {
    const entries = Object.entries(OFFSET_TABLES);

    it('has entries', () => {
        expect(entries.length).toBeGreaterThan(0);
    });

    it('every table has no duplicate (dq,dr) cells', () => {
        for (const [sig, table] of entries) {
            expect(hasDupes(table), sig).toBe(false);
        }
    });

    it('every table has the correct origin count per pattern type', () => {
        for (const [sig, table] of entries) {
            const count = originCount(table);
            if (sig.includes('notSelf')) {
                // notSelf (caster excluded): 0 origins
                expect(count, sig).toBe(0);
            } else {
                // standard attack/support patterns: exactly 1 origin
                // (the 'all' case is handled in resolveCells, not as a table entry)
                expect(count, sig).toBe(1);
            }
        }
    });

    it('WHOLE_LANE has exactly one origin and no dupes', () => {
        expect(originCount(WHOLE_LANE)).toBe(1);
        expect(hasDupes(WHOLE_LANE)).toBe(false);
    });
});
