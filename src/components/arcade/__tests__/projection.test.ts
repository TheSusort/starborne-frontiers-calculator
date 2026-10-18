import { describe, it, expect } from 'vitest';
import { project, PLAYER_DEPTH, gridOffsetDelta, laneWidthAtPlayer } from '../projection';
import {
    sceneGeometry,
    depthToScreenY,
    GRID_FAR_PLANE,
    GRID_NEAR_PLANE,
} from '../../theme/synthwaveScene';
import { SPAWN_Z } from '../../../utils/arcade/constants';

const g = sceneGeometry(1200, 800);

describe('project', () => {
    it('puts the player row at PLAYER_DEPTH with scale 1', () => {
        const p = project(g, 0, 0);
        expect(p.scale).toBeCloseTo(1);
        expect(p.y).toBeCloseTo(depthToScreenY(g, PLAYER_DEPTH));
        expect(p.x).toBe(g.vanishX);
    });
    it('puts the spawn row on the grid far plane', () => {
        expect(project(g, 0, SPAWN_Z).y).toBeCloseTo(depthToScreenY(g, GRID_FAR_PLANE));
    });
    it('moves up the screen and shrinks as z grows', () => {
        const near = project(g, 1, 10);
        const far = project(g, 1, 40);
        expect(far.y).toBeLessThan(near.y);
        expect(far.scale).toBeLessThan(near.scale);
        expect(far.x - g.vanishX).toBeLessThan(near.x - g.vanishX);
    });
    it('places lanes one lane-width apart at the player row', () => {
        expect(project(g, 1, 0).x - project(g, 0, 0).x).toBeCloseTo(laneWidthAtPlayer(g));
    });
    it('stays finite behind the player', () => {
        expect(Number.isFinite(project(g, 0, -6).y)).toBe(true);
    });
});

describe('gridOffsetDelta', () => {
    it('scrolls one full grid cycle per far-to-near span of world travel', () => {
        expect(gridOffsetDelta(SPAWN_Z)).toBeCloseTo(
            (GRID_FAR_PLANE - PLAYER_DEPTH) / (GRID_FAR_PLANE - GRID_NEAR_PLANE)
        );
    });
});
