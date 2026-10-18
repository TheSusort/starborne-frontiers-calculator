import { describe, it, expect } from 'vitest';
import {
    arcadeGridColumns,
    COLUMNS_PER_LANE,
    DEPTH_PER_UNIT,
    project,
    PLAYER_DEPTH,
    gridOffsetDelta,
    laneWidthAtPlayer,
    screenHeadingDeg,
} from '../projection';
import {
    sceneGeometry,
    depthToScreenY,
    gridLineEnds,
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

/** Screen x of drawn grid line `i` at screen row `y`, interpolated between the ends `drawGrid`
 *  strokes, so the lanes are checked against the lines as drawn, not against `project`'s maths. */
function drawnLineX(g: ReturnType<typeof sceneGeometry>, i: number, y: number): number {
    const columns = arcadeGridColumns(g);
    const { topX, bottomX } = gridLineEnds(g, columns, i / columns.count);
    return topX + ((bottomX - topX) * (y - g.horizonY)) / g.gridHeight;
}

describe('lanes on the arcade grid', () => {
    const screens = [
        [1200, 800],
        [1920, 1080],
        [800, 800],
        [390, 844],
    ] as const;
    const zs = [-2, 0, 3.7, 10, 25, SPAWN_Z];

    for (const [w, h] of screens) {
        const g = sceneGeometry(w, h);
        const columns = arcadeGridColumns(g);
        const middle = (columns.count - COLUMNS_PER_LANE) / 2;

        it(`puts every lane edge on a drawn grid line at ${w}x${h}`, () => {
            expect(Number.isInteger(middle)).toBe(true);
            for (const z of zs) {
                const y = project(g, 0, z).y;
                for (let edge = -1.5; edge <= 1.5; edge += 1) {
                    const line = middle + (edge + 0.5) * COLUMNS_PER_LANE;
                    expect(project(g, edge, z).x).toBeCloseTo(drawnLineX(g, line, y), 6);
                }
            }
        });

        it(`keeps the middle lane on the vanishing point at ${w}x${h}`, () => {
            for (const z of zs) expect(project(g, 0, z).x).toBeCloseTo(g.vanishX, 9);
        });

        it(`moves each lane along one straight column at ${w}x${h}`, () => {
            // Screen x is linear in screen y along a column, so equal y steps give equal x steps.
            for (const lane of [-1, 1]) {
                const pts = zs.map((z) => project(g, lane, z));
                const slope = (pts[1].x - pts[0].x) / (pts[1].y - pts[0].y);
                for (const p of pts) {
                    expect(p.x - pts[0].x).toBeCloseTo(slope * (p.y - pts[0].y), 6);
                }
            }
        });

        it(`keeps the lane width at the player row at ${w}x${h}`, () => {
            expect(project(g, 0, 0).width).toBeCloseTo(laneWidthAtPlayer(g), 6);
            expect(project(g, 1, 0).x - project(g, 0, 0).x).toBeCloseTo(laneWidthAtPlayer(g), 6);
        });
    }

    it('narrows lanes with depth but keeps them apart at the horizon', () => {
        const near = project(g, 0, 0).width;
        const far = project(g, 0, SPAWN_Z).width;
        expect(far).toBeLessThan(near / 5);
        expect(far).toBeGreaterThan(0);
        // At the far plane the lane is within a few pixels of the old pure-perspective width.
        const perspective =
            (laneWidthAtPlayer(g) * PLAYER_DEPTH) / (PLAYER_DEPTH + SPAWN_Z * DEPTH_PER_UNIT);
        expect(Math.abs(far - perspective)).toBeLessThan(6);
    });
});

describe('screenHeadingDeg', () => {
    const screens = [
        [1200, 800],
        [1920, 1080],
        [800, 800],
        [390, 844],
    ] as const;

    for (const [w, h] of screens) {
        const g = sceneGeometry(w, h);
        it(`aims the ship at the vanishing point at ${w}x${h}`, () => {
            for (const laneX of [-1, -0.4, 0, 0.7, 1]) {
                const p = project(g, laneX, 0);
                const a = (screenHeadingDeg(g, laneX) * Math.PI) / 180;
                // Walking from the ship along the heading reaches the horizon at vanishX.
                const reach = p.y - g.horizonY;
                expect(p.x + Math.tan(a) * reach).toBeCloseTo(g.vanishX, 6);
            }
        });
        it(`points the left lane right, the centre straight and the right lane left at ${w}x${h}`, () => {
            expect(screenHeadingDeg(g, -1)).toBeGreaterThan(0);
            expect(screenHeadingDeg(g, 0)).toBe(0);
            expect(screenHeadingDeg(g, 1)).toBeLessThan(0);
            expect(screenHeadingDeg(g, 1)).toBeCloseTo(-screenHeadingDeg(g, -1), 9);
        });
        it(`turns smoothly with the slide at ${w}x${h}`, () => {
            let last = Infinity;
            for (let x = -1; x <= 1.0001; x += 0.1) {
                const a = screenHeadingDeg(g, x);
                expect(a).toBeLessThan(last);
                last = a;
            }
        });
    }

    it('stays within the frame grid on any screen', () => {
        for (const [w, h] of screens) {
            expect(Math.abs(screenHeadingDeg(sceneGeometry(w, h), 1))).toBeLessThanOrEqual(47);
        }
    });
});
