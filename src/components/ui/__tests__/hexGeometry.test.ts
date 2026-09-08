import { describe, it, expect } from 'vitest';
import { HEX_RADIUS, axialToPixel, hexPoints } from '../hexGeometry';

describe('hexGeometry', () => {
    it('places the origin at 0,0', () => {
        expect(axialToPixel(0, 0)).toEqual([0, 0]);
    });

    it('offsets +q along x by radius * sqrt(3)', () => {
        const [x, y] = axialToPixel(1, 0);
        expect(x).toBeCloseTo(HEX_RADIUS * Math.sqrt(3), 5);
        expect(y).toBeCloseTo(0, 5);
    });

    it('offsets +r down by radius * 1.5 and half a hex right (pointy-top stagger)', () => {
        const [x, y] = axialToPixel(0, 1);
        expect(x).toBeCloseTo((HEX_RADIUS * Math.sqrt(3)) / 2, 5);
        expect(y).toBeCloseTo(HEX_RADIUS * 1.5, 5);
    });

    it('emits six comma-separated vertices with the first pointing straight up', () => {
        const pts = hexPoints(0, 0, 10).split(' ');
        expect(pts).toHaveLength(6);
        const [firstX, firstY] = pts[0].split(',').map(Number);
        expect(firstX).toBeCloseTo(0, 1);
        expect(firstY).toBeCloseTo(-10, 1);
    });
});
