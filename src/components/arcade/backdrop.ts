import {
    drawGridFan,
    drawGround,
    drawMountains,
    drawSky,
    drawSunGlow,
    mountainsTop,
    ScenePalette,
    SceneGeometry,
    sunCircle,
    sunGlowBottom,
    SUNSET_SCENE,
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
 * source-over compositing is associative. Each layer is drawn in a `ScenePalette` and re-rendered
 * when it is given another palette object.
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
    palette: ScenePalette | null;
}

const emptyLayer = (): Layer => ({ canvas: null, top: 0, w: 0, h: 0, dpr: 0, palette: null });

export const createBackdrop = (): Backdrop => ({
    sky: emptyLayer(),
    glow: emptyLayer(),
    ground: emptyLayer(),
    fan: emptyLayer(),
});

/** The device-pixel rows each layer covers: the sky down to one row past the horizon (the
 *  ground covers it from the horizon on), the sun's glow down to `sunGlowBottom` but no further
 *  than the sky, the ground
 *  from one row above the mountains' top, the fan from one row above the horizon. */
export function backdropRows(
    g: SceneGeometry,
    dpr: number
): Record<keyof Backdrop, [number, number]> {
    const canvasRows = Math.round(g.h * dpr);
    const skyBottom = Math.min(canvasRows, Math.ceil(g.horizonY * dpr) + 1);
    return {
        sky: [0, skyBottom],
        glow: [0, Math.min(skyBottom, Math.ceil(sunGlowBottom(g) * dpr))],
        ground: [Math.max(0, Math.floor(mountainsTop(g) * dpr) - 1), canvasRows],
        fan: [Math.max(0, Math.floor(g.horizonY * dpr) - 1), canvasRows],
    };
}

/** Re-renders `which` layer if the geometry, pixel ratio or palette changed, and returns it. */
function layerOf(
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    which: keyof Backdrop,
    palette: ScenePalette
): Layer {
    const layer = backdrop[which];
    if (
        !layer.canvas ||
        layer.w !== g.w ||
        layer.h !== g.h ||
        layer.dpr !== dpr ||
        layer.palette !== palette
    ) {
        const rows = backdropRows(g, dpr)[which];
        const canvas = (layer.canvas ??= document.createElement('canvas'));
        canvas.width = Math.round(g.w * dpr);
        canvas.height = Math.max(1, rows[1] - rows[0]);
        const c = canvas.getContext('2d');
        if (!c) return layer;
        c.setTransform(dpr, 0, 0, dpr, 0, -rows[0]);
        if (which === 'sky') {
            drawSky(c, g, palette);
        } else if (which === 'glow') {
            drawSunGlow(c, g, palette);
        } else if (which === 'ground') {
            drawMountains(c, g);
            drawGround(c, g, palette);
        } else {
            drawGridFan(c, g, introGridLayers(g, 1), palette);
        }
        layer.top = rows[0];
        layer.w = g.w;
        layer.h = g.h;
        layer.dpr = dpr;
        layer.palette = palette;
    }
    return layer;
}

/** Blits `which` layer 1:1 onto the canvas. */
function blit(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    which: keyof Backdrop,
    palette: ScenePalette
): void {
    const layer = layerOf(g, backdrop, dpr, which, palette);
    if (!layer.canvas) return;
    const { width, height } = layer.canvas;
    ctx.drawImage(layer.canvas, 0, 0, width, height, 0, layer.top / dpr, width / dpr, height / dpr);
}

/** Blits `which` layer once more at `alpha`, scaled by `scale` about (`cx`, `cy`): a brighter
 *  (and bigger) copy over the one already drawn. */
function blitOver(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    dpr: number,
    alpha: number,
    scale: number,
    cx: number,
    cy: number
): void {
    if (!layer.canvas || alpha <= 0) return;
    const { width, height } = layer.canvas;
    const w = width / dpr;
    const h = height / dpr;
    const top = layer.top / dpr;
    const before = ctx.globalAlpha;
    ctx.globalAlpha = before * Math.min(1, alpha);
    const x = cx + (0 - cx) * scale;
    const y = cy + (top - cy) * scale;
    ctx.drawImage(layer.canvas, 0, 0, width, height, x, y, w * scale, h * scale);
    ctx.globalAlpha = before;
}

/** The sky and its nebulae. */
export const drawBackdropSky = (
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    palette: ScenePalette = SUNSET_SCENE
): void => blit(ctx, g, backdrop, dpr, 'sky', palette);

/** How much brighter the sun's glow and the grid's fan get at a beat pulse of 1, as the opacity
 *  of a second copy drawn over them, and how much bigger the glow swells. */
export const GLOW_BEAT_ALPHA = 0.7;
export const FAN_BEAT_ALPHA = 0.55;
export const GLOW_BEAT_SWELL = 0.12;

/** The sun's outer glow; drawn after the stars. A beat `pulse` (0..1) brightens it and, with
 *  `swell`, grows it about the sun's centre. */
export function drawBackdropGlow(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    palette: ScenePalette = SUNSET_SCENE,
    pulse = 0,
    swell = false
): void {
    blit(ctx, g, backdrop, dpr, 'glow', palette);
    if (pulse <= 0) return;
    const { sunX, sunY } = sunCircle(g);
    const scale = swell ? 1 + GLOW_BEAT_SWELL * pulse : 1;
    blitOver(ctx, backdrop.glow, dpr, GLOW_BEAT_ALPHA * pulse, scale, sunX, sunY);
}

/** The mountains, the ground and the horizon's glow line. */
export const drawBackdropGround = (
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    palette: ScenePalette = SUNSET_SCENE
): void => blit(ctx, g, backdrop, dpr, 'ground', palette);

/** The grid's vertical fan, once the intro's grid transition is over, and its centre glow. A
 *  beat `pulse` (0..1) brightens it. */
export function drawBackdropFan(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    palette: ScenePalette = SUNSET_SCENE,
    pulse = 0
): void {
    blit(ctx, g, backdrop, dpr, 'fan', palette);
    if (pulse > 0) blitOver(ctx, backdrop.fan, dpr, FAN_BEAT_ALPHA * pulse, 1, 0, 0);
}
