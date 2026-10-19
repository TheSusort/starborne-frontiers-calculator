import {
    drawGridFan,
    drawGround,
    drawMountains,
    drawSky,
    drawSunGlow,
    mountainsTop,
    SceneGeometry,
} from '../theme/synthwaveScene';
import { introGridLayers } from './projection';

/**
 * The arcade's static scenery, rendered once per screen size into device-pixel caches and
 * blitted 1:1 every frame: the sky (with its nebulae and the sun's glow) down to the horizon,
 * the mountains and ground from the highest peak down, and the grid's vertical fan with its
 * centre glow. The stars and the sun's disc animate, so they draw live between the first two,
 * and the scrolling horizontal grid lines between the last two. Blitting the fan's cached
 * composite over the lines matches drawing its parts over them, since source-over compositing
 * is associative.
 */
export interface Backdrop {
    sky: Layer;
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
    ground: emptyLayer(),
    fan: emptyLayer(),
});

/** The device-pixel rows each layer covers: the sky down to one row past the horizon (the
 *  ground covers it from the horizon on), the ground from one row above the mountains' top, the
 *  fan from one row above the horizon. */
export function backdropRows(
    g: SceneGeometry,
    dpr: number
): { sky: [number, number]; ground: [number, number]; fan: [number, number] } {
    const canvasRows = Math.round(g.h * dpr);
    return {
        sky: [0, Math.min(canvasRows, Math.ceil(g.horizonY * dpr) + 1)],
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

/** The sky, its nebulae and the sun's outer glow. */
export const drawBackdropSky = (
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number
): void => blit(ctx, g, backdrop, dpr, 'sky');

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
