import {
    defaultGridColumns,
    depthToScreenY,
    GRID_FAR_PLANE,
    GRID_NEAR_PLANE,
    GridColumns,
    GridLayer,
    gridLineX,
    SceneGeometry,
} from '../theme/synthwaveScene';
import { SPAWN_Z } from '../../utils/arcade/constants';

/** Grid depth of the player row: slightly above the bottom edge of the screen. */
export const PLAYER_DEPTH = 1.35;
/** Maps world z onto grid depth so the spawn row lands on the grid's far plane. */
export const DEPTH_PER_UNIT = (GRID_FAR_PLANE - PLAYER_DEPTH) / SPAWN_Z;
const MIN_DEPTH = 0.2;
/** Grid columns per lane; odd, so the middle lane is a column centred on the vanishing point. */
export const COLUMNS_PER_LANE = 1;
/** Columns in the arcade's grid fan; odd for the same reason, and wide enough to fill any screen. */
const ARCADE_GRID_COLUMNS = 41;

export function laneWidthAtPlayer(g: SceneGeometry): number {
    return Math.min(g.w * 0.26, g.h * 0.42);
}

/**
 * The arcade's grid fan: the background's horizon spread, centred on the vanishing point at the
 * bottom too, with the bottom spread chosen so a lane is exactly `COLUMNS_PER_LANE` columns wide
 * at the player row. Lanes and every object on them are placed on these columns.
 */
export function arcadeGridColumns(g: SceneGeometry): GridColumns {
    const count = ARCADE_GRID_COLUMNS;
    const topSpread = defaultGridColumns(g).topSpread;
    const f = GRID_NEAR_PLANE / PLAYER_DEPTH;
    const pitch = laneWidthAtPlayer(g) / COLUMNS_PER_LANE;
    const bottomSpread = (pitch * count - topSpread * (1 - f)) / f;
    return { count, topSpread, bottomSpread, bottomLeft: g.vanishX - bottomSpread / 2 };
}

/**
 * The vertical grid while the intro flies the ship in from the page background, `k` running
 * 0..1: both fans' spreads and bottom edge move linearly from the page's to the arcade's, and
 * since the two have different line counts, the page's lines fade out on that moving fan while
 * the arcade's fade in. `k` = 0 is exactly the page grid and `k` >= 1 exactly the arcade's.
 */
export function introGridLayers(g: SceneGeometry, k: number): GridLayer[] {
    const page = defaultGridColumns(g);
    const arcade = arcadeGridColumns(g);
    if (k <= 0) return [{ columns: page, alpha: 1 }];
    if (k >= 1) return [{ columns: arcade, alpha: 1 }];
    const lerp = (a: number, b: number) => a + (b - a) * k;
    const fan = {
        topSpread: lerp(page.topSpread, arcade.topSpread),
        bottomSpread: lerp(page.bottomSpread, arcade.bottomSpread),
        bottomLeft: lerp(page.bottomLeft, arcade.bottomLeft),
    };
    return [
        { columns: { count: page.count, ...fan }, alpha: 1 - k },
        { columns: { count: arcade.count, ...fan }, alpha: k },
    ];
}

/** Fan position of a lane offset: lane 0 is the middle column, one lane is `COLUMNS_PER_LANE`. */
export function laneToGridT(laneX: number): number {
    return 0.5 + (laneX * COLUMNS_PER_LANE) / ARCADE_GRID_COLUMNS;
}

const depthAt = (z: number) => Math.max(MIN_DEPTH, PLAYER_DEPTH + z * DEPTH_PER_UNIT);

/**
 * `laneX` is the lane offset from the centre (-1, 0, 1, or fractional while sliding). `x` follows
 * the arcade grid's columns at every depth, `width` is one lane's width at that depth, and
 * `scale` is the perspective scale relative to the player row.
 */
export function project(g: SceneGeometry, laneX: number, z: number) {
    const depth = depthAt(z);
    const columns = arcadeGridColumns(g);
    const x = gridLineX(g, columns, laneToGridT(laneX), depth);
    const width =
        gridLineX(g, columns, laneToGridT(laneX + 0.5), depth) -
        gridLineX(g, columns, laneToGridT(laneX - 0.5), depth);
    return { x, y: depthToScreenY(g, depth), scale: PLAYER_DEPTH / depth, width };
}

/** Grid scroll (in `drawGrid`'s 0..1 offset units) that matches `travelUnits` of world travel. */
export function gridOffsetDelta(travelUnits: number): number {
    return (travelUnits * DEPTH_PER_UNIT) / (GRID_FAR_PLANE - GRID_NEAR_PLANE);
}

/**
 * Screen angle, in degrees, from the ship's spot on the player row to the vanishing point
 * (`vanishX`, `horizonY`): 0 points straight up the screen, positive leans toward screen right.
 * `laneX` is the rendered lane offset, so the angle turns continuously while the ship slides.
 */
export function screenHeadingDeg(g: SceneGeometry, laneX: number): number {
    const p = project(g, laneX, 0);
    return (Math.atan2(g.vanishX - p.x, p.y - g.horizonY) * 180) / Math.PI;
}
