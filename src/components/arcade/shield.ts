import { ARCADE_ACCENT_CSS } from './ships/arcadeAccent';

/**
 * The player's energy shield: a translucent bubble around the ship, drawn in two halves so it
 * wraps the ship. `drawShieldBack` (before the ship) draws the bubble's body and the far half of
 * its equator ring; `drawShieldFront` (after it) draws the near half of the ring and the glowing
 * rim. The body is a cached image per size bucket; nothing here allocates per frame once the
 * bucket is cached, and nothing uses shadowBlur.
 */

const CYAN = '64, 240, 255';
const PINK = '255, 79, 216';
const CYAN_CORE = 'rgb(170, 250, 255)';
const PINK_CORE = ARCADE_ACCENT_CSS;
const CYAN_GLOW = `rgba(${CYAN}, 0.3)`;
const PINK_GLOW = `rgba(${PINK}, 0.3)`;
const SHEEN = 'rgba(255, 255, 255, 0.55)';

/** Bubble radii in ship units `s` (the neon fighter spans x ±2.2s). */
export const SHIELD_RX = 2.7;
export const SHIELD_RY = 1.85;
/** The equator ring: its centre below the bubble's, and its depth as a share of its width. */
const EQUATOR_DROP = 0.15;
const EQUATOR_DEPTH = 0.22;
/** The ring tilts by this many radians at full bank, like the hull. */
const BANK_TILT = 0.25;
/** One shimmer band sweeps the bubble top to bottom in this time. */
const SHIMMER_MS = 1600;

/** Body images are cached for radii on a geometric ladder of this ratio, from `MIN_BUCKET_PX`. */
export const BUCKET_RATIO = 1.15;
export const MIN_BUCKET_PX = 4;
/** Most body images kept; the oldest is dropped beyond it. */
export const MAX_CACHED_BUCKETS = 16;

/** The ladder step for a body `radiusPx` device pixels across: the smallest step at or above it,
 *  so a cached body is never magnified by more than `BUCKET_RATIO`. */
export function shieldBucket(radiusPx: number): number {
    if (!(radiusPx > MIN_BUCKET_PX)) return 0;
    return Math.ceil(Math.log(radiusPx / MIN_BUCKET_PX) / Math.log(BUCKET_RATIO) - 1e-9);
}

export const bucketRadiusPx = (bucket: number): number => MIN_BUCKET_PX * BUCKET_RATIO ** bucket;

const bodies = new Map<number, HTMLCanvasElement>();

/** The bubble's body as a circle of the bucket's radius: a clear centre deepening to a cyan edge
 *  with a pink lip, crossed by faint horizontal scanlines. Stretched to the ellipse when drawn. */
function bodyImage(radiusPx: number): HTMLCanvasElement | null {
    const bucket = shieldBucket(radiusPx);
    const cached = bodies.get(bucket);
    if (cached) return cached;
    const r = Math.ceil(bucketRadiusPx(bucket));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2 * r;
    const c = canvas.getContext('2d');
    if (!c) return null;
    const fill = c.createRadialGradient(r, r * 0.8, 0, r, r, r);
    fill.addColorStop(0, `rgba(${CYAN}, 0)`);
    fill.addColorStop(0.55, `rgba(${CYAN}, 0.05)`);
    fill.addColorStop(0.82, `rgba(${CYAN}, 0.18)`);
    fill.addColorStop(0.95, `rgba(${PINK}, 0.32)`);
    fill.addColorStop(1, `rgba(${PINK}, 0)`);
    c.beginPath();
    c.arc(r, r, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    c.clip();
    const pitch = Math.max(3, r / 9);
    c.fillStyle = `rgba(${CYAN}, 0.1)`;
    for (let y = pitch / 2; y < 2 * r; y += pitch) c.fillRect(0, y, 2 * r, Math.max(1, pitch / 4));
    bodies.set(bucket, canvas);
    if (bodies.size > MAX_CACHED_BUCKETS) bodies.delete(bodies.keys().next().value as number);
    return canvas;
}

let shimmer: CanvasGradient | null = null;

/** A unit-height vertical band, transparent at both ends, mapped onto the bubble by transform. */
function shimmerGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
    if (!shimmer) {
        shimmer = ctx.createLinearGradient(0, 0, 0, 1);
        shimmer.addColorStop(0, `rgba(${CYAN}, 0)`);
        shimmer.addColorStop(0.5, `rgba(${CYAN}, 0.22)`);
        shimmer.addColorStop(1, `rgba(${CYAN}, 0)`);
    }
    return shimmer;
}

/** Where and how big the bubble is: centred on the ship at (`x`, `y`), `s` its ship unit, `dpr`
 *  the canvas's device pixels per CSS pixel, `bank` -1..1 and `flatten` 0..1 (a duck flattens the
 *  bubble a little). */
export interface ShieldPlacement {
    x: number;
    y: number;
    s: number;
    dpr: number;
    bank: number;
    flatten: number;
}

/** Glow pulse between 0.8 and 1. */
const pulseAt = (timeMs: number) => 0.9 + 0.1 * Math.sin(timeMs * 0.004);

function radii(p: ShieldPlacement): { rx: number; ry: number } {
    return { rx: p.s * SHIELD_RX, ry: p.s * SHIELD_RY * (1 - 0.2 * p.flatten) };
}

/** Half of the equator ring, the far half (`back`) or the near half. */
function equatorHalf(
    ctx: CanvasRenderingContext2D,
    p: ShieldPlacement,
    rx: number,
    ry: number,
    back: boolean,
    alpha: number
): void {
    const cy = p.y + ry * EQUATOR_DROP;
    const ringRx = rx * 0.96;
    const ringRy = ringRx * EQUATOR_DEPTH;
    const tilt = p.bank * BANK_TILT;
    ctx.beginPath();
    ctx.ellipse(p.x, cy, ringRx, ringRy, tilt, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI);
    ctx.globalAlpha = alpha * (back ? 0.45 : 1);
    ctx.strokeStyle = PINK_GLOW;
    ctx.lineWidth = Math.max(2, p.s * 0.35);
    ctx.stroke();
    ctx.strokeStyle = PINK_CORE;
    ctx.lineWidth = Math.max(1, p.s * 0.09);
    ctx.stroke();
}

/** The bubble's body and the far half of its ring; draw before the ship. */
export function drawShieldBack(
    ctx: CanvasRenderingContext2D,
    p: ShieldPlacement,
    timeMs: number
): void {
    const { rx, ry } = radii(p);
    const body = bodyImage(Math.max(rx, ry) * p.dpr);
    const alpha = ctx.globalAlpha;
    const pulse = pulseAt(timeMs);
    if (body) {
        ctx.globalAlpha = alpha * pulse;
        ctx.drawImage(body, p.x - rx, p.y - ry, 2 * rx, 2 * ry);
    }
    // A shimmer band sweeping down through the bubble.
    const band = ry * 0.7;
    const t = (timeMs % SHIMMER_MS) / SHIMMER_MS;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(p.x - rx, p.y - ry - band + t * (2 * ry + band));
    ctx.scale(2 * rx, band);
    ctx.fillStyle = shimmerGradient(ctx);
    ctx.globalAlpha = alpha * pulse;
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
    equatorHalf(ctx, p, rx, ry, true, alpha * pulse);
    ctx.globalAlpha = alpha;
}

/** The near half of the ring and the rim: a thin cyan core in a glow that is cyan over the top
 *  and pink under; draw after the ship. */
export function drawShieldFront(
    ctx: CanvasRenderingContext2D,
    p: ShieldPlacement,
    timeMs: number
): void {
    const { rx, ry } = radii(p);
    const alpha = ctx.globalAlpha;
    const pulse = pulseAt(timeMs);
    equatorHalf(ctx, p, rx, ry, false, alpha * pulse);
    for (let half = 0; half < 2; half++) {
        const top = half === 0;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, ry, 0, top ? Math.PI : 0, top ? Math.PI * 2 : Math.PI);
        ctx.globalAlpha = alpha * pulse;
        ctx.strokeStyle = top ? CYAN_GLOW : PINK_GLOW;
        ctx.lineWidth = Math.max(2, p.s * 0.45);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = CYAN_CORE;
        ctx.lineWidth = Math.max(1, p.s * (top ? 0.1 : 0.07));
        ctx.stroke();
    }
    // A specular glint on the upper left of the bubble.
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx * 0.82, ry * 0.8, 0, Math.PI * 1.12, Math.PI * 1.38);
    ctx.globalAlpha = alpha * pulse;
    ctx.strokeStyle = SHEEN;
    ctx.lineWidth = Math.max(1, p.s * 0.14);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = alpha;
}

/** Fragment directions (radians, on the ellipse) and per-fragment spread and spin, fixed so the
 *  break looks the same every time and allocates nothing. */
const SHARDS = Array.from({ length: 12 }, (_, i) => ({
    angle: (i / 12) * Math.PI * 2 + 0.2 * Math.sin(i * 2.3),
    spread: 0.8 + 0.4 * ((i * 7) % 5) * 0.25,
    spin: (i % 2 === 0 ? 1 : -1) * (0.6 + ((i * 3) % 4) * 0.2),
}));
const SHARD_ARC = 0.38;

/**
 * The bubble shattering, `k` running 0..1 over the break: a white flash of the body, a neon
 * ripple racing outward and arc shards of the rim flying off and spinning as they fade.
 */
export function drawShieldBreak(
    ctx: CanvasRenderingContext2D,
    p: ShieldPlacement,
    k: number
): void {
    const { rx, ry } = radii(p);
    const alpha = ctx.globalAlpha;
    const fade = 1 - k;
    if (k < 0.3) {
        const body = bodyImage(Math.max(rx, ry) * p.dpr);
        if (body) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = alpha * (1 - k / 0.3);
            ctx.drawImage(body, p.x - rx, p.y - ry, 2 * rx, 2 * ry);
            ctx.globalCompositeOperation = 'source-over';
        }
    }
    const grow = 1 + 0.9 * k;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx * grow, ry * grow, 0, 0, Math.PI * 2);
    ctx.globalAlpha = alpha * fade * fade;
    ctx.strokeStyle = CYAN_GLOW;
    ctx.lineWidth = Math.max(3, p.s * 0.7 * fade);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, p.s * 0.12);
    ctx.stroke();

    ctx.globalAlpha = alpha * fade;
    ctx.lineCap = 'round';
    for (let i = 0; i < SHARDS.length; i++) {
        const shard = SHARDS[i];
        const out = k * p.s * 2.4 * shard.spread;
        const cx = p.x + Math.cos(shard.angle) * out;
        const cy = p.y + Math.sin(shard.angle) * out * (ry / rx);
        ctx.beginPath();
        ctx.ellipse(
            cx,
            cy,
            rx,
            ry,
            shard.spin * k,
            shard.angle - SHARD_ARC / 2,
            shard.angle + SHARD_ARC / 2
        );
        ctx.strokeStyle = i % 2 === 0 ? CYAN_CORE : PINK_CORE;
        ctx.lineWidth = Math.max(1.5, p.s * 0.16);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = alpha;
}

/** The shield pickup: a small bubble of the same make, `r` its radius, at (`x`, `y`). */
export function drawShieldPickup(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    dpr: number,
    scale: number
): void {
    const body = bodyImage(r * dpr);
    if (body) ctx.drawImage(body, x - r, y - r, 2 * r, 2 * r);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.25, r * 0.95, r * 0.26, 0, 0, Math.PI * 2);
    ctx.strokeStyle = PINK_CORE;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = CYAN_CORE;
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.stroke();
}
