import type { SceneGeometry } from '../theme/synthwaveScene';
import { projectInto, type Projected } from './projection';

/**
 * The player ship's explosion when a run ends: a bright flash, a neon shockwave ring lying on the
 * track in perspective, a burst of sparks in the arcade's pink, cyan and orange that slow, fall
 * and fade, and embers that linger a little longer. The particles live in a preallocated pool,
 * drawn in a fixed set of colour and opacity batches, so nothing is allocated per frame and no
 * `shadowBlur` is used. Under reduced motion there are no particles or ring, only the flash
 * fading out.
 */

export const SPARKS = 84;
export const EMBERS = 30;
const PARTICLES = SPARKS + EMBERS;

/** How long the explosion has anything left to draw. */
export const EXPLOSION_SECONDS = 1.7;
const FLASH_SECONDS = 0.32;
const REDUCED_FLASH_SECONDS = 0.45;
const SCREEN_FLASH_SECONDS = 0.16;
const RING_SECONDS = 0.7;
/** The shockwave's final radius on the track, in lane widths. */
const RING_RADIUS = 1.7;

/** Gravity, in lane widths per second squared, and the sparks' drag per second. */
const SPARK_GRAVITY = 1.4;
const EMBER_GRAVITY = 0.35;
const SPARK_DRAG = 2.6;
const EMBER_DRAG = 1.2;
/** A spark is drawn as a streak covering this much of its own motion. */
const STREAK_SECONDS = 0.035;

/** The world slows to a stop over this long after the crash. */
export const SLOW_MOTION_SECONDS = 0.7;
/** The share of the run's speed the world keeps right after the crash. */
const SLOW_MOTION_START = 0.35;

/** The share of the run's speed the world moves at `elapsed` seconds after the crash: a brief
 *  slow motion easing to a stop, or a stop at once under reduced motion. */
export function slowMotion(elapsed: number, reducedMotion: boolean): number {
    if (reducedMotion || elapsed >= SLOW_MOTION_SECONDS) return 0;
    const k = 1 - Math.max(0, elapsed) / SLOW_MOTION_SECONDS;
    return SLOW_MOTION_START * k * k;
}

const COLOURS = ['#ff4fd8', '#40f0ff', '#ffa040'] as const;
/** Opacity steps a particle's fade is drawn in. */
const ALPHA_STEPS = 4;

export interface Explosion {
    started: boolean;
    reducedMotion: boolean;
    elapsed: number;
    /** Where the ship was drawn (px), and the lane width at the player row (px). */
    x: number;
    y: number;
    u: number;
    /** The ship's lane offset, for the ring on the track. */
    laneX: number;
    /** Particle offsets from (`x`, `y`) and velocities, in px and px per second. */
    px: Float32Array;
    py: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
    /** Seconds lived and seconds to live; a particle is out once `age` reaches `ttl`. */
    age: Float32Array;
    ttl: Float32Array;
    colour: Uint8Array;
}

export function createExplosion(): Explosion {
    return {
        started: false,
        reducedMotion: false,
        elapsed: 0,
        x: 0,
        y: 0,
        u: 1,
        laneX: 0,
        px: new Float32Array(PARTICLES),
        py: new Float32Array(PARTICLES),
        vx: new Float32Array(PARTICLES),
        vy: new Float32Array(PARTICLES),
        age: new Float32Array(PARTICLES),
        ttl: new Float32Array(PARTICLES),
        colour: new Uint8Array(PARTICLES),
    };
}

/**
 * Sets the explosion off at (`x`, `y`) for a ship at lane offset `laneX`, `u` px per lane width,
 * refilling the pool in place. `random` draws the burst (0..1).
 */
export function startExplosion(
    e: Explosion,
    x: number,
    y: number,
    u: number,
    laneX: number,
    reducedMotion: boolean,
    random: () => number
): void {
    e.started = true;
    e.reducedMotion = reducedMotion;
    e.elapsed = 0;
    e.x = x;
    e.y = y;
    e.u = u;
    e.laneX = laneX;
    for (let i = 0; i < PARTICLES; i++) {
        const ember = i >= SPARKS;
        const angle = random() * Math.PI * 2;
        const speed = (ember ? 0.15 + 0.5 * random() : 0.9 + 2.2 * random()) * u;
        e.px[i] = (random() - 0.5) * 0.08 * u;
        e.py[i] = (random() - 0.5) * 0.05 * u;
        e.vx[i] = Math.cos(angle) * speed;
        // A little flatter than round and lifted, so the burst reads against the track.
        e.vy[i] = Math.sin(angle) * speed * 0.75 - (ember ? 0.25 : 0.35) * u;
        e.age[i] = 0;
        e.ttl[i] = reducedMotion ? 0 : ember ? 0.9 + 0.7 * random() : 0.4 + 0.5 * random();
        e.colour[i] = ember ? (random() < 0.6 ? 2 : 0) : Math.floor(random() * COLOURS.length);
    }
}

/** Ages the explosion by `dt` seconds: particles move, slow, fall and burn out. */
export function advanceExplosion(e: Explosion, dt: number): void {
    if (!e.started || !(dt > 0)) return;
    e.elapsed += dt;
    for (let i = 0; i < PARTICLES; i++) {
        if (e.age[i] >= e.ttl[i]) continue;
        const ember = i >= SPARKS;
        const drag = Math.exp(-(ember ? EMBER_DRAG : SPARK_DRAG) * dt);
        e.vx[i] *= drag;
        e.vy[i] = e.vy[i] * drag + (ember ? EMBER_GRAVITY : SPARK_GRAVITY) * e.u * dt;
        e.px[i] += e.vx[i] * dt;
        e.py[i] += e.vy[i] * dt;
        e.age[i] += dt;
    }
}

/** Particles still burning. */
export function liveParticles(e: Explosion): number {
    let n = 0;
    for (let i = 0; i < PARTICLES; i++) if (e.age[i] < e.ttl[i]) n++;
    return n;
}

/** Whether the explosion has anything left to draw. */
export const explosionActive = (e: Explosion): boolean =>
    e.started && e.elapsed < (e.reducedMotion ? REDUCED_FLASH_SECONDS : EXPLOSION_SECONDS) + 1e-9;

/** A particle's remaining brightness, 0..1: sparks fade linearly, embers flicker as they go. */
function particleAlpha(e: Explosion, i: number): number {
    const left = 1 - e.age[i] / e.ttl[i];
    if (i < SPARKS) return left;
    const flicker = 0.75 + 0.25 * Math.sin(e.age[i] * 37 + i * 1.7);
    return left * flicker;
}

let flashSprite: HTMLCanvasElement | null = null;

/** A soft radial flash, white at the core through pink to nothing, drawn once and scaled. */
function flashImage(): HTMLCanvasElement | null {
    if (flashSprite) return flashSprite;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    if (!c) return null;
    const grad = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.18, 'rgba(255, 230, 250, 0.95)');
    grad.addColorStop(0.42, 'rgba(255, 79, 216, 0.55)');
    grad.addColorStop(0.7, 'rgba(176, 108, 255, 0.18)');
    grad.addColorStop(1, 'rgba(176, 108, 255, 0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, size, size);
    flashSprite = canvas;
    return canvas;
}

const near: Projected = { x: 0, y: 0, scale: 0, width: 0 };
const far: Projected = { x: 0, y: 0, scale: 0, width: 0 };

/** The shockwave: an ellipse on the track under the ship, `r` lane widths in radius. */
function drawRing(ctx: CanvasRenderingContext2D, g: SceneGeometry, e: Explosion): void {
    const k = Math.min(1, e.elapsed / RING_SECONDS);
    if (k >= 1) return;
    const ease = 1 - (1 - k) * (1 - k) * (1 - k);
    const r = 0.15 + (RING_RADIUS - 0.15) * ease;
    projectInto(g, e.laneX, r, far);
    projectInto(g, e.laneX, -r, near);
    const cx = (far.x + near.x) / 2;
    const cy = (far.y + near.y) / 2;
    const ry = Math.max(1, (near.y - far.y) / 2);
    const rx = r * e.u;
    const fade = 1 - k;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = COLOURS[0];
    ctx.globalAlpha = 0.28 * fade;
    ctx.lineWidth = Math.max(3, 0.09 * e.u * fade);
    ctx.stroke();
    ctx.strokeStyle = COLOURS[1];
    ctx.globalAlpha = 0.5 * fade;
    ctx.lineWidth = Math.max(1.5, 0.035 * e.u * fade);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.6 * fade;
    ctx.lineWidth = 1;
    ctx.stroke();
}

/** The sparks as short streaks along their motion, and the embers as small squares, batched by
 *  colour and opacity step. */
function drawParticles(ctx: CanvasRenderingContext2D, e: Explosion): void {
    const sparkWidth = Math.max(1, 0.022 * e.u);
    const ember = Math.max(1.5, 0.026 * e.u);
    for (let c = 0; c < COLOURS.length; c++) {
        ctx.strokeStyle = COLOURS[c];
        ctx.fillStyle = COLOURS[c];
        for (let step = 1; step <= ALPHA_STEPS; step++) {
            const lo = (step - 1) / ALPHA_STEPS;
            const hi = step / ALPHA_STEPS;
            let sparks = false;
            ctx.beginPath();
            for (let i = 0; i < SPARKS; i++) {
                if (e.colour[i] !== c || e.age[i] >= e.ttl[i]) continue;
                const a = particleAlpha(e, i);
                if (a <= lo || a > hi) continue;
                const x = e.x + e.px[i];
                const y = e.y + e.py[i];
                ctx.moveTo(x, y);
                ctx.lineTo(x - e.vx[i] * STREAK_SECONDS, y - e.vy[i] * STREAK_SECONDS);
                sparks = true;
            }
            if (sparks) {
                ctx.globalAlpha = hi;
                ctx.lineWidth = sparkWidth;
                ctx.stroke();
            }
            let embers = false;
            ctx.beginPath();
            for (let i = SPARKS; i < PARTICLES; i++) {
                if (e.colour[i] !== c || e.age[i] >= e.ttl[i]) continue;
                const a = particleAlpha(e, i);
                if (a <= lo || a > hi) continue;
                ctx.rect(e.x + e.px[i] - ember / 2, e.y + e.py[i] - ember / 2, ember, ember);
                embers = true;
            }
            if (embers) {
                ctx.globalAlpha = hi;
                ctx.fill();
            }
        }
    }
}

/**
 * Draws the explosion over the scene: the screen flash, the ring, the particles and the flash on
 * the ship's spot, all added light. `w` and `h` are the screen's size.
 */
export function drawExplosion(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    e: Explosion,
    w: number,
    h: number
): void {
    if (!explosionActive(e)) return;
    const alpha = ctx.globalAlpha;
    const op = ctx.globalCompositeOperation;
    const cap = ctx.lineCap;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const t = e.elapsed;
    if (!e.reducedMotion) {
        if (t < SCREEN_FLASH_SECONDS) {
            ctx.globalAlpha = 0.22 * (1 - t / SCREEN_FLASH_SECONDS);
            ctx.fillStyle = COLOURS[0];
            ctx.fillRect(0, 0, w, h);
        }
        drawRing(ctx, g, e);
        drawParticles(ctx, e);
    }
    const flashFor = e.reducedMotion ? REDUCED_FLASH_SECONDS : FLASH_SECONDS;
    const img = t < flashFor ? flashImage() : null;
    if (img) {
        const k = t / flashFor;
        const size = e.u * (e.reducedMotion ? 1.1 : 0.9 + 1.6 * Math.sqrt(k));
        ctx.globalAlpha = (1 - k) * (1 - k);
        ctx.drawImage(img, e.x - size / 2, e.y - size / 2, size, size);
    }
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.lineCap = cap;
}
