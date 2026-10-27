import type { SceneGeometry } from '../theme/synthwaveScene';

/**
 * The speed blur's edge fringe: a pink and cyan colour split along the screen's edges, pink on
 * the left, cyan on the right, and blending across the top and bottom, faded toward the centre.
 * It is rendered once per screen size into a device-pixel cache with the lane wedge (see
 * `laneWedge`) cut out, so it never covers the track, and its edge bands are blitted each frame
 * at the blur's strength.
 */
export interface Fringe {
    canvas: HTMLCanvasElement | null;
    /** The geometry, pixel ratio and lane wedge it was drawn for. */
    w: number;
    h: number;
    dpr: number;
    wedge: number;
    /** The bands' screen rectangles as x, y, width, height, from `fringeBands`. */
    bands: number[];
}

export const createFringe = (): Fringe => ({
    canvas: null,
    w: 0,
    h: 0,
    dpr: 0,
    wedge: -1,
    bands: [],
});

const PINK = '255, 79, 216';
const CYAN = '64, 240, 255';
/** The fringe's opacity at the very edge, at full strength. */
const EDGE_ALPHA = 0.42;
/** Band depths, as shares of the screen's width (left, right) and height (top, bottom). */
export const SIDE_BAND = 0.09;
export const END_BAND = 0.12;
/** How far past the lane wedge, in radians, the fringe fades back in. */
const WEDGE_FEATHER = 0.12;
const FEATHER_PASSES = 6;

/** The bands' screen rectangles, flattened as x, y, width, height: top, bottom, then left and
 *  right between them. */
export function fringeBands(g: SceneGeometry): number[] {
    const side = Math.ceil(g.w * SIDE_BAND);
    const end = Math.ceil(g.h * END_BAND);
    const middle = Math.max(0, g.h - 2 * end);
    return [
        0,
        0,
        g.w,
        end,
        0,
        g.h - end,
        g.w,
        end,
        0,
        end,
        side,
        middle,
        g.w - side,
        end,
        side,
        middle,
    ];
}

function render(c: CanvasRenderingContext2D, g: SceneGeometry, wedge: number): void {
    const { w, h } = g;
    const side = Math.ceil(w * SIDE_BAND);
    const end = Math.ceil(h * END_BAND);
    // Top and bottom: pink to cyan across, faded toward the centre by erasing.
    for (const [y, inward] of [
        [0, 1],
        [h, -1],
    ] as const) {
        const across = c.createLinearGradient(0, 0, w, 0);
        across.addColorStop(0, `rgba(${PINK}, ${EDGE_ALPHA})`);
        across.addColorStop(1, `rgba(${CYAN}, ${EDGE_ALPHA})`);
        c.fillStyle = across;
        const top = inward > 0 ? 0 : h - end;
        c.fillRect(0, top, w, end);
        const fade = c.createLinearGradient(0, y, 0, y + inward * end);
        fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
        fade.addColorStop(0.35, 'rgba(0, 0, 0, 0.7)');
        fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
        c.globalCompositeOperation = 'destination-out';
        c.fillStyle = fade;
        c.fillRect(0, top, w, end);
        c.globalCompositeOperation = 'source-over';
    }
    for (const [x, inward, colour] of [
        [0, 1, PINK],
        [w, -1, CYAN],
    ] as const) {
        const band = c.createLinearGradient(x, 0, x + inward * side, 0);
        band.addColorStop(0, `rgba(${colour}, ${EDGE_ALPHA})`);
        band.addColorStop(0.35, `rgba(${colour}, ${EDGE_ALPHA * 0.3})`);
        band.addColorStop(1, `rgba(${colour}, 0)`);
        c.fillStyle = band;
        c.fillRect(inward > 0 ? 0 : w - side, 0, side, h);
    }
    // The lane wedge, from the vanishing point down, stays clear; its edge feathers out over
    // `WEDGE_FEATHER` radians in widening, partly erasing passes.
    const reach = h - g.horizonY;
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    for (let i = 0; i <= FEATHER_PASSES; i++) {
        const angle = Math.min(wedge + (WEDGE_FEATHER * i) / FEATHER_PASSES, Math.PI / 2 - 0.01);
        const spread = Math.tan(angle) * reach;
        c.globalAlpha = i === 0 ? 1 : 0.3;
        c.beginPath();
        c.moveTo(g.vanishX, g.horizonY);
        c.lineTo(g.vanishX + spread, h);
        c.lineTo(g.vanishX - spread, h);
        c.closePath();
        c.fill();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
}

/** Draws the fringe at `strength` (0..1), re-rendering it first if the geometry, pixel ratio or
 *  lane wedge changed. */
export function drawSpeedFringe(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    fringe: Fringe,
    dpr: number,
    wedge: number,
    strength: number
): void {
    if (strength <= 0) return;
    if (
        !fringe.canvas ||
        fringe.w !== g.w ||
        fringe.h !== g.h ||
        fringe.dpr !== dpr ||
        fringe.wedge !== wedge
    ) {
        const canvas = (fringe.canvas ??= document.createElement('canvas'));
        canvas.width = Math.round(g.w * dpr);
        canvas.height = Math.round(g.h * dpr);
        const c = canvas.getContext('2d');
        if (!c) return;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        render(c, g, wedge);
        fringe.w = g.w;
        fringe.h = g.h;
        fringe.dpr = dpr;
        fringe.wedge = wedge;
        fringe.bands = fringeBands(g);
    }
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * Math.min(1, strength);
    const b = fringe.bands;
    for (let i = 0; i < b.length; i += 4) {
        const x = b[i];
        const y = b[i + 1];
        const bw = b[i + 2];
        const bh = b[i + 3];
        if (bw <= 0 || bh <= 0) continue;
        ctx.drawImage(fringe.canvas, x * dpr, y * dpr, bw * dpr, bh * dpr, x, y, bw, bh);
    }
    ctx.globalAlpha = alpha;
}
