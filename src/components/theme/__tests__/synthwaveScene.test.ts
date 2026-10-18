import { describe, it, expect } from 'vitest';
import {
    sceneGeometry,
    depthToScreenY,
    hitTestOverheadShip,
    OVERHEAD_HIT_RADIUS,
    GRID_NEAR_PLANE,
    GRID_FAR_PLANE,
} from '../synthwaveScene';

describe('sceneGeometry', () => {
    it('puts the horizon at 45% of the height and the vanishing point at the centre', () => {
        const g = sceneGeometry(1000, 800);
        expect(g.horizonY).toBe(360);
        expect(g.gridHeight).toBe(440);
        expect(g.vanishX).toBe(500);
    });
});

describe('depthToScreenY', () => {
    it('maps the near plane to the bottom and far depths toward the horizon', () => {
        const g = sceneGeometry(1000, 800);
        expect(depthToScreenY(g, GRID_NEAR_PLANE)).toBe(800);
        const far = depthToScreenY(g, GRID_FAR_PLANE);
        expect(far).toBeGreaterThan(g.horizonY);
        expect(far).toBeLessThan(g.horizonY + 40);
    });
});

describe('hitTestOverheadShip', () => {
    const ship = { x: 100, y: 100, size: 5, progress: 0.3 };
    it('hits inside the radius', () => {
        expect(hitTestOverheadShip(ship, 100 + OVERHEAD_HIT_RADIUS - 1, 100)).toBe(true);
    });
    it('misses outside the radius', () => {
        expect(hitTestOverheadShip(ship, 100 + OVERHEAD_HIT_RADIUS + 1, 100)).toBe(false);
    });
    it('misses once the ship is near the horizon', () => {
        expect(hitTestOverheadShip({ ...ship, progress: 0.9 }, 100, 100)).toBe(false);
    });
    it('misses when no ship is flying', () => {
        expect(hitTestOverheadShip(null, 100, 100)).toBe(false);
    });
});
