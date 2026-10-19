import type { ObstacleKind } from '../../utils/arcade/types';

/**
 * Obstacle silhouettes, in lane widths `u` above the obstacle's ground point (negative is up).
 * A wall fills the lane; a low laser is a bar near the ground to jump over; a high arch is a bar
 * to duck under. The arch bar's bottom edge (-0.30u) sits between the ducking ship's top (about
 * -0.24u) and the running ship's top (about -0.38u), so only a duck visibly clears it.
 */
const WALL = { halfWidth: 0.42, top: -0.9 };
const LOW = { halfWidth: 0.45, barTop: -0.22, barBottom: -0.14, postTop: -0.26, post: 0.04 };
const HIGH = { halfWidth: 0.47, barTop: -0.62, barBottom: -0.3, post: 0.05 };

interface Palette {
    /** Gradient fill, top to bottom. */
    top: string;
    bottom: string;
    /** Wide faint glow stroke and thin bright core stroke. */
    glow: string;
    core: string;
}

const PINK: Palette = {
    top: 'rgba(255, 79, 216, 0.9)',
    bottom: 'rgba(90, 16, 120, 0.9)',
    glow: 'rgba(255, 79, 216, 0.35)',
    core: '#ffc2f0',
};
const CYAN: Palette = {
    top: 'rgba(160, 250, 255, 1)',
    bottom: 'rgba(30, 150, 220, 1)',
    glow: 'rgba(64, 240, 255, 0.4)',
    core: '#e6feff',
};
const SUNSET: Palette = {
    top: 'rgba(255, 196, 80, 0.95)',
    bottom: 'rgba(255, 70, 150, 0.95)',
    glow: 'rgba(255, 150, 60, 0.38)',
    core: '#ffe2b0',
};
const POST_FILL = 'rgba(20, 8, 40, 0.92)';
const SCANLINE = 'rgba(20, 0, 40, 0.28)';
/** Scanline pitch in lane widths; scanlines are skipped once they would be closer than
 *  `MIN_SCANLINE_PX`. */
const SCANLINE_PITCH = 0.06;
const MIN_SCANLINE_PX = 3;

/** Unit-square vertical gradients, one per palette, built on first use and reused every frame:
 *  `fillGradientRect` maps the unit square onto the rectangle with the transform. */
const gradients = new Map<Palette, CanvasGradient>();

function gradientOf(ctx: CanvasRenderingContext2D, palette: Palette): CanvasGradient {
    let gradient = gradients.get(palette);
    if (!gradient) {
        gradient = ctx.createLinearGradient(0, 0, 0, 1);
        gradient.addColorStop(0, palette.top);
        gradient.addColorStop(1, palette.bottom);
        gradients.set(palette, gradient);
    }
    return gradient;
}

function fillGradientRect(
    ctx: CanvasRenderingContext2D,
    palette: Palette,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(w, h);
    ctx.fillStyle = gradientOf(ctx, palette);
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
}

/** Thin dark horizontal bands across a rectangle, like the sun's stripes. */
function scanlines(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    u: number
): void {
    const pitch = SCANLINE_PITCH * u;
    if (pitch < MIN_SCANLINE_PX) return;
    ctx.fillStyle = SCANLINE;
    const band = Math.max(1, pitch * 0.35);
    for (let sy = y + pitch * 0.5; sy < y + h; sy += pitch) {
        ctx.fillRect(x, sy, w, Math.min(band, y + h - sy));
    }
}

/** The double-stroke neon outline `drawGrid` uses for its glow: a wide faint stroke under a thin
 *  bright one, with no shadowBlur. `pulse` scales the glow's opacity. */
function neonOutline(
    ctx: CanvasRenderingContext2D,
    palette: Palette,
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
    pulse: number
): void {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * pulse;
    ctx.strokeStyle = palette.glow;
    ctx.lineWidth = Math.max(2, 7 * scale);
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = palette.core;
    ctx.lineWidth = Math.max(1, 1.6 * scale);
    ctx.strokeRect(x, y, w, h);
}

/** A horizontal neon line: glow under core. */
function neonLine(
    ctx: CanvasRenderingContext2D,
    palette: Palette,
    x0: number,
    x1: number,
    y: number,
    glowWidth: number,
    coreWidth: number,
    pulse: number
): void {
    const alpha = ctx.globalAlpha;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.globalAlpha = alpha * pulse;
    ctx.strokeStyle = palette.glow;
    ctx.lineWidth = glowWidth;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = palette.core;
    ctx.lineWidth = coreWidth;
    ctx.stroke();
}

/** Glow pulse between 0.7 and 1, phase-shifted per obstacle so a row does not pulse in step. */
export function barrierPulse(timeMs: number, id: number): number {
    return 0.85 + 0.15 * Math.sin(timeMs * 0.005 + id * 1.7);
}

/**
 * Draws one obstacle standing on the ground point (`x`, `y`), `u` lane widths wide at the
 * obstacle's depth, `scale` its perspective scale. The caller's `globalAlpha` (the fade-in)
 * scales everything; `lineCap` and `globalAlpha` are left as found.
 */
export function drawBarrier(
    ctx: CanvasRenderingContext2D,
    kind: ObstacleKind,
    x: number,
    y: number,
    u: number,
    scale: number,
    pulse: number
): void {
    if (kind === 'wall') {
        const left = x - WALL.halfWidth * u;
        const top = y + WALL.top * u;
        const w = 2 * WALL.halfWidth * u;
        const h = -WALL.top * u;
        fillGradientRect(ctx, PINK, left, top, w, h);
        scanlines(ctx, left, top, w, h, u);
        neonOutline(ctx, PINK, left, top, w, h, scale, pulse);
        // A bright top edge, like a horizon line.
        neonLine(ctx, CYAN, left, left + w, top, Math.max(2, 5 * scale), Math.max(1, scale), pulse);
    } else if (kind === 'low') {
        const half = LOW.halfWidth * u;
        const post = LOW.post * u;
        const postTop = y + LOW.postTop * u;
        for (const px of [x - half - post / 2, x + half - post / 2]) {
            ctx.fillStyle = POST_FILL;
            ctx.fillRect(px, postTop, post, -LOW.postTop * u);
            neonOutline(ctx, CYAN, px, postTop, post, -LOW.postTop * u, scale * 0.6, pulse);
        }
        const barTop = y + LOW.barTop * u;
        const barH = (LOW.barTop - LOW.barBottom) * -u;
        fillGradientRect(ctx, CYAN, x - half, barTop, 2 * half, barH);
        // The beam: a pulsing glow as tall as the bar, around a white-hot core.
        neonLine(
            ctx,
            CYAN,
            x - half,
            x + half,
            barTop + barH / 2,
            barH * 2.2,
            Math.max(1, barH * 0.35),
            pulse
        );
    } else {
        const half = HIGH.halfWidth * u;
        const post = HIGH.post * u;
        const barTop = y + HIGH.barTop * u;
        const barH = (HIGH.barBottom - HIGH.barTop) * u;
        for (const px of [x - half, x + half - post]) {
            ctx.fillStyle = POST_FILL;
            ctx.fillRect(px, barTop, post, -HIGH.barTop * u);
            neonOutline(ctx, SUNSET, px, barTop, post, -HIGH.barTop * u, scale * 0.6, pulse);
        }
        fillGradientRect(ctx, SUNSET, x - half, barTop, 2 * half, barH);
        scanlines(ctx, x - half, barTop, 2 * half, barH, u);
        neonOutline(ctx, SUNSET, x - half, barTop, 2 * half, barH, scale, pulse);
        // The bottom edge is the clearance a duck passes under; it reads brightest.
        neonLine(
            ctx,
            PINK,
            x - half,
            x + half,
            barTop + barH,
            Math.max(2, 6 * scale),
            Math.max(1, 1.8 * scale),
            pulse
        );
    }
}
