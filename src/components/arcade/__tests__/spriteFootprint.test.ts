import { describe, expect, it } from 'vitest';
import { opaqueFootprint } from '../spriteFootprint';

/** An RGBA buffer `w`×`h` with the given pixels opaque. */
function image(w: number, h: number, opaque: [number, number][], alpha = 255) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of opaque) data[(y * w + x) * 4 + 3] = alpha;
    return data;
}

describe('opaqueFootprint', () => {
    it('measures from the frame centre to the farther side and to the top and bottom', () => {
        // A 10×10 frame, opaque pixels spanning x 3..7 and y 2..5.
        const fp = opaqueFootprint(
            image(10, 10, [
                [3, 2],
                [7, 5],
                [5, 4],
            ]),
            10,
            10
        );
        expect(fp).toEqual({ halfWidth: 0.3, top: -0.3, bottom: 0.1 });
    });

    it('uses the farther side when the ship is off-centre', () => {
        const fp = opaqueFootprint(
            image(10, 10, [
                [1, 5],
                [5, 5],
            ]),
            10,
            10
        );
        expect(fp?.halfWidth).toBeCloseTo(0.4);
    });

    it('ignores faint pixels and reports none for an empty frame', () => {
        expect(opaqueFootprint(image(8, 8, [[1, 1]], 10), 8, 8)).toBeNull();
        expect(opaqueFootprint(new Uint8ClampedArray(8 * 8 * 4), 8, 8)).toBeNull();
    });
});
