import { JUMP_SCALE_GAIN } from '../../utils/arcade/constants';

/**
 * The player's energy shield: a faint field hugging the ship, lit like glass. Almost clear in the
 * middle, it brightens only toward its edge (a fresnel falloff) in soft cyan with a hint of
 * magenta underneath, with a very faint hex texture, a slow sheen drifting across it and a
 * hairline equator that passes behind the ship and in front of it. `drawShieldBack` draws
 * before the ship, `drawShieldFront` after it. Bodies are cached images per size bucket, and
 * gradients are built once in unit space and mapped by transform, so a frame allocates nothing
 * once its bucket is cached. No shadowBlur.
 */

const CYAN = '120, 230, 255';
const PINK = '255, 110, 220';
const CYAN_LINE = `rgb(${CYAN})`;
const PINK_LINE = `rgb(${PINK})`;

/** The equator hairline: its centre below the field's, and its depth as a share of its width. */
const EQUATOR_DROP = 0.18;
const EQUATOR_DEPTH = 0.2;
/** The equator tilts by this many radians at full bank, like the hull. */
const BANK_TILT = 0.25;
/** The sheen drifts across the field once in this time. */
const SHEEN_MS = 4200;

/** Body images are cached for radii on a geometric ladder of this ratio, from `MIN_BUCKET_PX`. */
export const BUCKET_RATIO = 1.15;
export const MIN_BUCKET_PX = 4;

/** The ship's body images kept, least recently used dropped first: the ladder steps one jump
 *  sweeps through (its scale grows by `JUMP_SCALE_GAIN`), plus one spare for a resize. The
 *  shield pickup has a body of its own and never touches this cache. */
export const MAX_CACHED_BUCKETS =
    Math.ceil(Math.log(1 + JUMP_SCALE_GAIN) / Math.log(BUCKET_RATIO)) + 2;

/** The ladder step for a body `radiusPx` device pixels across: the smallest step at or above it,
 *  so a cached body is never magnified by more than `BUCKET_RATIO`. */
export function shieldBucket(radiusPx: number): number {
    if (!(radiusPx > MIN_BUCKET_PX)) return 0;
    return Math.ceil(Math.log(radiusPx / MIN_BUCKET_PX) / Math.log(BUCKET_RATIO) - 1e-9);
}

export const bucketRadiusPx = (bucket: number): number => MIN_BUCKET_PX * BUCKET_RATIO ** bucket;

/** The ship's bodies by bucket, in use order: a hit moves its entry to the end. */
const bodies = new Map<number, HTMLCanvasElement>();
/** The pickup's one body and its bucket. */
let pickupBody: HTMLCanvasElement | null = null;
let pickupBucket = -1;
/** Scratch for a body's hex texture, shared by every build. */
let hexScratch: HTMLCanvasElement | null = null;

/** The field's body as a circle of the bucket's radius, stretched to the ellipse when drawn: a
 *  fresnel rim, a magenta lip underneath and a faint hex texture that fades in toward the rim. */
function buildBody(bucket: number): HTMLCanvasElement | null {
    const r = Math.ceil(bucketRadiusPx(bucket));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2 * r;
    const c = canvas.getContext('2d');
    if (!c) return null;
    c.beginPath();
    c.arc(r, r, r, 0, Math.PI * 2);
    c.clip();

    const rim = c.createRadialGradient(r, r, 0, r, r, r);
    rim.addColorStop(0, `rgba(${CYAN}, 0)`);
    rim.addColorStop(0.6, `rgba(${CYAN}, 0.012)`);
    rim.addColorStop(0.84, `rgba(${CYAN}, 0.05)`);
    rim.addColorStop(0.95, `rgba(${CYAN}, 0.16)`);
    rim.addColorStop(0.99, 'rgba(225, 250, 255, 0.3)');
    rim.addColorStop(1, `rgba(${CYAN}, 0)`);
    c.fillStyle = rim;
    c.fillRect(0, 0, 2 * r, 2 * r);

    const lip = c.createRadialGradient(r, r * 0.55, r * 0.9, r, r * 0.55, r * 1.45);
    lip.addColorStop(0, `rgba(${PINK}, 0)`);
    lip.addColorStop(0.75, `rgba(${PINK}, 0.07)`);
    lip.addColorStop(1, `rgba(${PINK}, 0)`);
    c.fillStyle = lip;
    c.fillRect(0, 0, 2 * r, 2 * r);

    // Hex cells, masked to the outer band so the middle stays clear. Resizing the scratch clears
    // its pixels and resets its context.
    const cell = Math.max(4, r / 7);
    const hex = (hexScratch ??= document.createElement('canvas'));
    hex.width = hex.height = 2 * r;
    const h = hex.getContext('2d');
    if (h) {
        h.strokeStyle = `rgba(${CYAN}, 0.5)`;
        h.lineWidth = 1;
        h.beginPath();
        const dx = cell * Math.sqrt(3);
        for (let row = 0, y = 0; y < 2 * r + cell; row++, y += cell * 1.5) {
            for (let x = row % 2 ? dx / 2 : 0; x < 2 * r + dx; x += dx) {
                for (let k = 0; k < 6; k++) {
                    const a = (Math.PI / 3) * k + Math.PI / 6;
                    const px = x + cell * Math.cos(a);
                    const py = y + cell * Math.sin(a);
                    if (k === 0) h.moveTo(px, py);
                    else h.lineTo(px, py);
                }
                h.closePath();
            }
        }
        h.stroke();
        h.globalCompositeOperation = 'destination-in';
        const band = h.createRadialGradient(r, r, r * 0.55, r, r, r);
        band.addColorStop(0, 'rgba(0, 0, 0, 0)');
        band.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
        h.fillStyle = band;
        h.fillRect(0, 0, 2 * r, 2 * r);
        c.drawImage(hex, 0, 0);
    }
    return canvas;
}

/** The ship's body for a field `radiusPx` device pixels across, through the LRU cache. */
function bodyImage(radiusPx: number): HTMLCanvasElement | null {
    const bucket = shieldBucket(radiusPx);
    const cached = bodies.get(bucket);
    if (cached) {
        bodies.delete(bucket);
        bodies.set(bucket, cached);
        return cached;
    }
    const canvas = buildBody(bucket);
    if (!canvas) return null;
    bodies.set(bucket, canvas);
    if (bodies.size > MAX_CACHED_BUCKETS) bodies.delete(bodies.keys().next().value as number);
    return canvas;
}

let sheen: CanvasGradient | null = null;
let glint: CanvasGradient | null = null;

/** A soft band across the unit square's width, mapped onto the field by transform. */
function sheenGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
    if (!sheen) {
        sheen = ctx.createLinearGradient(0, 0, 1, 0);
        sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
        sheen.addColorStop(0.5, 'rgba(220, 248, 255, 0.07)');
        sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    }
    return sheen;
}

/** A soft round highlight on the unit circle, mapped onto the field by transform. */
function glintGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
    if (!glint) {
        glint = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        glint.addColorStop(0, 'rgba(240, 252, 255, 0.16)');
        glint.addColorStop(1, 'rgba(240, 252, 255, 0)');
    }
    return glint;
}

/** Where and how big the field is: an ellipse of radii `rx`, `ry` centred on (`x`, `y`). `dpr`
 *  is the canvas's device pixels per CSS pixel and `bank` the ship's bank, -1..1. */
export interface ShieldPlacement {
    x: number;
    y: number;
    rx: number;
    ry: number;
    dpr: number;
    bank: number;
}

/** Sizes `out` around a ship whose visible pixels reach `halfWidth` either side of its centre
 *  and `halfHeight` above and below: a close fit with a little air, never flatter than 2:1. */
export function fitShield(out: ShieldPlacement, halfWidth: number, halfHeight: number): void {
    out.rx = halfWidth * 1.15 + halfHeight * 0.15;
    out.ry = Math.max(halfHeight * 1.2 + halfWidth * 0.08, out.rx * 0.5);
}

/** Half of the equator hairline: the far half (`back`) or the near one. */
function equatorHalf(ctx: CanvasRenderingContext2D, p: ShieldPlacement, back: boolean): void {
    const alpha = ctx.globalAlpha;
    ctx.beginPath();
    ctx.ellipse(
        p.x,
        p.y + p.ry * EQUATOR_DROP,
        p.rx * 0.97,
        p.rx * 0.97 * EQUATOR_DEPTH,
        p.bank * BANK_TILT,
        back ? Math.PI : 0,
        back ? Math.PI * 2 : Math.PI
    );
    ctx.globalAlpha = alpha * (back ? 0.14 : 0.26);
    ctx.strokeStyle = CYAN_LINE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = alpha;
}

/** The field's body, its slow sheen and the far half of its equator; draw before the ship. */
export function drawShieldBack(
    ctx: CanvasRenderingContext2D,
    p: ShieldPlacement,
    timeMs: number
): void {
    const body = bodyImage(Math.max(p.rx, p.ry) * p.dpr);
    const alpha = ctx.globalAlpha;
    // A slow breath, never a pulse.
    ctx.globalAlpha = alpha * (0.92 + 0.08 * Math.sin(timeMs * 0.0012));
    if (body) ctx.drawImage(body, p.x - p.rx, p.y - p.ry, 2 * p.rx, 2 * p.ry);
    ctx.globalAlpha = alpha;

    // The sheen: a soft diagonal band drifting across, clipped to the field.
    const t = (timeMs % SHEEN_MS) / SHEEN_MS;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(p.x - p.rx * 2 + t * p.rx * 4, p.y);
    ctx.rotate(-0.5);
    ctx.scale(p.rx * 0.9, p.ry * 3);
    ctx.fillStyle = sheenGradient(ctx);
    ctx.fillRect(-0.5, -0.5, 1, 1);
    ctx.restore();

    equatorHalf(ctx, p, true);
}

/** The near half of the equator, a hairline rim and a soft glint; draw after the ship. */
export function drawShieldFront(
    ctx: CanvasRenderingContext2D,
    p: ShieldPlacement,
    timeMs: number
): void {
    equatorHalf(ctx, p, false);
    const alpha = ctx.globalAlpha;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
    ctx.globalAlpha = alpha * (0.3 + 0.05 * Math.sin(timeMs * 0.0012));
    ctx.strokeStyle = CYAN_LINE;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.translate(p.x - p.rx * 0.45, p.y - p.ry * 0.55);
    ctx.scale(p.rx * 0.35, p.ry * 0.22);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = glintGradient(ctx);
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    ctx.globalAlpha = alpha;
}

/** Fragment directions (radians, on the ellipse) and spreads, fixed so the break allocates
 *  nothing and looks the same every time. */
const SHARDS = Array.from({ length: 10 }, (_, i) => ({
    angle: (i / 10) * Math.PI * 2 + 0.25 * Math.sin(i * 2.3),
    spread: 0.7 + 0.12 * ((i * 7) % 5),
}));
const SHARD_ARC = 0.22;

/**
 * The field failing, `k` running 0..1 over the break: the body flares and fades, one hairline
 * ripple runs outward and short hairline fragments of the rim drift off as they fade.
 */
export function drawShieldBreak(
    ctx: CanvasRenderingContext2D,
    p: ShieldPlacement,
    k: number
): void {
    const alpha = ctx.globalAlpha;
    const fade = 1 - k;
    const body = bodyImage(Math.max(p.rx, p.ry) * p.dpr);
    if (body) {
        ctx.globalAlpha = alpha * fade * fade * 1.6;
        ctx.drawImage(body, p.x - p.rx, p.y - p.ry, 2 * p.rx, 2 * p.ry);
    }
    const grow = 1 + 0.6 * Math.sqrt(k);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx * grow, p.ry * grow, 0, 0, Math.PI * 2);
    ctx.globalAlpha = alpha * fade * 0.6;
    ctx.strokeStyle = 'rgb(225, 250, 255)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.globalAlpha = alpha * fade * 0.7;
    ctx.strokeStyle = CYAN_LINE;
    for (let i = 0; i < SHARDS.length; i++) {
        const shard = SHARDS[i];
        const out = 1 + k * 0.35 * shard.spread;
        ctx.beginPath();
        ctx.ellipse(
            p.x,
            p.y,
            p.rx * out,
            p.ry * out,
            0,
            shard.angle - SHARD_ARC / 2,
            shard.angle + SHARD_ARC / 2
        );
        ctx.stroke();
    }
    ctx.globalAlpha = alpha;
}

/** The shield pickup: a small field of the same make, `r` its radius, at (`x`, `y`). Its rim
 *  is a little stronger than the ship's so it reads at a distance. Its body is one image sized
 *  for `bodyRadiusPx`, its radius in device pixels at the player row, and scaled to `r`: the
 *  pickup's size sweeps the whole ladder on its way in, so per-size bodies would rebuild every
 *  few frames. */
export function drawShieldPickup(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    bodyRadiusPx: number,
    scale: number
): void {
    const bucket = shieldBucket(bodyRadiusPx);
    if (bucket !== pickupBucket) {
        pickupBody = buildBody(bucket);
        pickupBucket = pickupBody ? bucket : -1;
    }
    if (pickupBody) ctx.drawImage(pickupBody, x - r, y - r, 2 * r, 2 * r);
    const alpha = ctx.globalAlpha;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.2, r * 0.97, r * 0.22, 0, 0, Math.PI * 2);
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = PINK_LINE;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = CYAN_LINE;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.stroke();
    ctx.globalAlpha = alpha;
}
