import { describe, it, expect } from 'vitest';
import { defaultGridColumns, gridLineEnds, sceneGeometry } from '../synthwaveScene';

/** The page background's vertical-line formula, written out independently of the module. */
function pageBackgroundLine(w: number, h: number, i: number) {
    const numVLines = w / h > 1.2 ? 40 : 20;
    const spreadBottom = Math.max(w * 10, h * 12);
    const horizonSpread = Math.max(h * 0.2, w * 0.15);
    const t = i / numVLines;
    return {
        count: numVLines,
        bottomX: -spreadBottom * 0.3 + t * spreadBottom,
        topX: w / 2 + (t - 0.5) * horizonSpread,
    };
}

describe('defaultGridColumns', () => {
    for (const [w, h] of [
        [1200, 800],
        [800, 800],
        [390, 844],
        [2560, 1080],
    ]) {
        it(`draws the page background's lines unchanged at ${w}x${h}`, () => {
            const g = sceneGeometry(w, h);
            const columns = defaultGridColumns(g);
            const expectedCount = pageBackgroundLine(w, h, 0).count;
            expect(columns.count).toBe(expectedCount);
            for (let i = 0; i <= expectedCount; i++) {
                const expected = pageBackgroundLine(w, h, i);
                const ends = gridLineEnds(g, columns, i / columns.count);
                expect(ends.topX).toBe(expected.topX);
                expect(ends.bottomX).toBe(expected.bottomX);
            }
        });
    }
});
