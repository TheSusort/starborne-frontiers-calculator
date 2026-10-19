import {
    drawGridFan,
    drawGround,
    drawMountains,
    drawSky,
    drawSunGlow,
    mountainsTop,
    SceneGeometry,
    sunGlowBottom,
} from '../theme/synthwaveScene';
import { introGridLayers } from './projection';

/**
 * The arcade's static scenery, rendered once per screen size into device-pixel caches and
 * blitted 1:1 every frame, in this order:
 * - the sky and its nebulae, down to the horizon;
 * - the stars, live;
 * - the sun's outer glow, on a transparent layer of its own, so the stars sit under it rather
 *   than brightening it;
 * - the sun's disc, live;
 * - the mountains and ground, from the highest peak down;
 * - the scrolling horizontal grid lines, live;
 * - the grid's vertical fan with its centre glow.
 * Blitting a cached composite over live drawing matches drawing its parts over it, since
 * source-over compositing is associative.
 */
export interface Backdrop {
    sky: Layer;
    glow: Layer;
    ground: Layer;
    fan: Layer;
}

interface Layer {
    canvas: HTMLCanvasElement | null;
    /** Device-pixel row of the canvas's top on the main canvas. */
    top: number;
    /** The geometry and pixel ratio it was drawn for. */
    w: number;
    h: number;
    dpr: number;
}

const emptyLayer = (): Layer => ({ canvas: null, top: 0, w: 0, h: 0, dpr: 0 });

export const createBackdrop = (): Backdrop => ({
    sky: emptyLayer(),
    glow: emptyLayer(),
    ground: emptyLayer(),
    fan: emptyLayer(),
});

/** The device-pixel rows each layer covers: the sky down to one row past the horizon (the
 *  ground covers it from the horizon on), the sun's glow down to `sunGlowBottom`, the ground
 *  from one row above the mountains' top, the fan from one row above the horizon. */
export function backdropRows(
    g: SceneGeometry,
    dpr: number
): Record<keyof Backdrop, [number, number]> {
    const canvasRows = Math.round(g.h * dpr);
    return {
        sky: [0, Math.min(canvasRows, Math.ceil(g.horizonY * dpr) + 1)],
        glow: [0, Math.min(canvasRows, Math.ceil(sunGlowBottom(g) * dpr))],
        ground: [Math.max(0, Math.floor(mountainsTop(g) * dpr) - 1), canvasRows],
        fan: [Math.max(0, Math.floor(g.horizonY * dpr) - 1), canvasRows],
    };
}

/** Blits `which` layer, re-rendering it first if the geometry or pixel ratio changed. */
function blit(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    which: keyof Backdrop
): void {
    const layer = backdrop[which];
    if (!layer.canvas || layer.w !== g.w || layer.h !== g.h || layer.dpr !== dpr) {
        const rows = backdropRows(g, dpr)[which];
        const canvas = (layer.canvas ??= document.createElement('canvas'));
        canvas.width = Math.round(g.w * dpr);
        canvas.height = Math.max(1, rows[1] - rows[0]);
        const c = canvas.getContext('2d');
        if (!c) return;
        c.setTransform(dpr, 0, 0, dpr, 0, -rows[0]);
        if (which === 'sky') {
            drawSky(c, g);
        } else if (which === 'glow') {
            drawSunGlow(c, g);
        } else if (which === 'ground') {
            drawMountains(c, g);
            drawGround(c, g);
        } else {
            drawGridFan(c, g, introGridLayers(g, 1));
        }
        layer.top = rows[0];
        layer.w = g.w;
        layer.h = g.h;
        layer.dpr = dpr;
    }
    const { width, height } = layer.canvas;
    ctx.drawImage(layer.canvas, 0, 0, width, height, 0, layer.top / dpr, width / dpr, height / dpr);
}

/** The sky and its nebulae. */
export const drawBackdropSky = (
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number
): void => blit(ctx, g, backdrop, dpr, 'sky');

/** The sun's outer glow; drawn after the stars. */
export const drawBackdropGlow = (
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number
): void => blit(ctx, g, backdrop, dpr, 'glow');

/** The mountains, the ground and the horizon's glow line. */
export const drawBackdropGround = (
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number
): void => blit(ctx, g, backdrop, dpr, 'ground');

/** The grid's vertical fan, once the intro's grid transition is over, and its centre glow. */
export const drawBackdropFan = (
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number
): void => blit(ctx, g, backdrop, dpr, 'fan');
