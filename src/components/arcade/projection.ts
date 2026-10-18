import {
    depthToScreenY,
    GRID_FAR_PLANE,
    GRID_NEAR_PLANE,
    SceneGeometry,
} from '../theme/synthwaveScene';
import { SPAWN_Z } from '../../utils/arcade/constants';

/** Grid depth of the player row: slightly above the bottom edge of the screen. */
export const PLAYER_DEPTH = 1.35;
/** Maps world z onto grid depth so the spawn row lands on the grid's far plane. */
export const DEPTH_PER_UNIT = (GRID_FAR_PLANE - PLAYER_DEPTH) / SPAWN_Z;
const MIN_DEPTH = 0.2;

export function laneWidthAtPlayer(g: SceneGeometry): number {
    return Math.min(g.w * 0.26, g.h * 0.42);
}

/** `laneX` is the lane offset from the centre (-1, 0, 1, or fractional while sliding). */
export function project(g: SceneGeometry, laneX: number, z: number) {
    const depth = Math.max(MIN_DEPTH, PLAYER_DEPTH + z * DEPTH_PER_UNIT);
    const scale = PLAYER_DEPTH / depth;
    return {
        x: g.vanishX + laneX * laneWidthAtPlayer(g) * scale,
        y: depthToScreenY(g, depth),
        scale,
    };
}

/** Grid scroll (in `drawGrid`'s 0..1 offset units) that matches `travelUnits` of world travel. */
export function gridOffsetDelta(travelUnits: number): number {
    return (travelUnits * DEPTH_PER_UNIT) / (GRID_FAR_PLANE - GRID_NEAR_PLANE);
}
