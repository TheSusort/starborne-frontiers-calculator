import {
    drawGround,
    drawMountains,
    drawSky,
    drawSunGlow,
    mountainsTop,
    SceneGeometry,
} from '../theme/synthwaveScene';

/**
 * The arcade's static scenery, rendered once per screen size into two device-pixel caches and
 * blitted 1:1 every frame: the sky (with its nebulae and the sun's glow) down to the horizon,
 * and the mountains and ground from the highest peak down. The stars and the sun's disc animate,
 * so they are drawn live between the two.
 */
export interface Backdrop {
    sky: Layer;
    ground: Layer;
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

export const createBackdrop = (): Backdrop => ({ sky: emptyLayer(), ground: emptyLayer() });

/** The device-pixel rows each layer covers: the sky down to one row past the horizon (the
 *  ground covers it from the horizon on), the ground from one row above the mountains' top. */
export function backdropRows(
    g: SceneGeometry,
    dpr: number
): { sky: [number, number]; ground: [number, number] } {
    const canvasRows = Math.round(g.h * dpr);
    return {
        sky: [0, Math.min(canvasRows, Math.ceil(g.horizonY * dpr) + 1)],
        ground: [Math.max(0, Math.floor(mountainsTop(g) * dpr) - 1), canvasRows],
    };
}

/** Blits `which` layer, re-rendering it first if the geometry or pixel ratio changed. */
function blit(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    backdrop: Backdrop,
    dpr: number,
    which: 'sky' | 'ground'
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
        } else {
            drawMountains(c, g);
            drawGround(c, g);
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
