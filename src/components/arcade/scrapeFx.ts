import type { SceneGeometry } from '../theme/synthwaveScene';
import { projectInto, type Projected } from './projection';
import { trailLaneX, type ShipTrail } from './shipTrails';

/**
 * Where a ducking ship's hull scrapes the track: sparks thrown back toward the camera and out to
 * the sides from the contact line, a bright line along the contact itself, and a short neon
 * streak burned into the grid behind the ship. The sparks live in a preallocated ring pool and
 * advance by game time, so they hold still whenever the game does not step; nothing is allocated
 * per frame and no `shadowBlur` is used. Under reduced motion the view has no scrape at all.
 */

export const SCRAPE_SPARKS = 56;
/** Sparks spawned per game second at full contact. */
export const SPARK_RATE = 110;
/** Gravity, in lane widths per second squared, and drag per second. */
const GRAVITY = 3.2;
const DRAG = 3;
/** A spark is drawn as a streak covering this much of its own motion. */
const STREAK_SECONDS = 0.03;
/** How fast the contact's glow follows the contact, in game seconds. */
const GLOW_SECONDS = 0.06;
/** The share of the hull's half-width the contact line spans. */
const CONTACT_SPAN = 0.6;
/** At full lean the contact narrows by this share and its centre moves this share of the
 *  half-width toward the low wing, which throws this much more of the sparks. */
const LEAN_NARROW = 0.5;
const LEAN_SHIFT = 0.45;
const LEAN_SIDE_BIAS = 0.4;
/** How sunk the hull must be, in lane widths, for the contact to burn at full strength. */
const FULL_CONTACT_SINK = 0.02;
/** The streak behind the ship runs to this world depth (negative: toward the camera). */
const STREAK_Z = -1.6;
const STREAK_SEGMENTS = 8;
/** How many game seconds back along the ship's trail the streak's far end lies. */
const STREAK_AGE = 0.2;

/** Spark colours: neon pink, cyan, and a white-hot orange. */
const COLOURS = ['#ff4fd8', '#40f0ff', '#ffc070'] as const;
const ALPHA_STEPS = 4;

/** The hull's contact with the track this frame (px): the ship's centre x and its visible
 *  half-width, the track line under it, the lane width at the player row, how sunk the belly
 *  is below the line, and its skid lean, -1..1 (see `skidLean`; positive: right side down). */
export interface ScrapeContact {
    x: number;
    y: number;
    halfWidth: number;
    u: number;
    sink: number;
    lean: number;
}

export interface ScrapeFx {
    /** Spark positions (px) and velocities (px per second). */
    px: Float32Array;
    py: Float32Array;
    vx: Float32Array;
    vy: Float32Array;
    /** Seconds lived and seconds to live; a spark is out once `age` reaches `ttl`. */
    age: Float32Array;
    ttl: Float32Array;
    colour: Uint8Array;
    /** The pool slot the next spark overwrites. */
    next: number;
    /** Fractional sparks owed to the next advance. */
    carry: number;
    /** The contact's brightness, 0..1, eased toward its strength. */
    glow: number;
    /** The lane width at the player row (px) of the last contact, which scales the sparks'
     *  gravity once the hull has left the track. */
    u: number;
}

export function createScrapeFx(): ScrapeFx {
    return {
        px: new Float32Array(SCRAPE_SPARKS),
        py: new Float32Array(SCRAPE_SPARKS),
        vx: new Float32Array(SCRAPE_SPARKS),
        vy: new Float32Array(SCRAPE_SPARKS),
        age: new Float32Array(SCRAPE_SPARKS),
        ttl: new Float32Array(SCRAPE_SPARKS),
        colour: new Uint8Array(SCRAPE_SPARKS),
        next: 0,
        carry: 0,
        glow: 0,
        u: 0,
    };
}

/** How hard the hull scrapes, 0..1: nothing until the belly is below the track line, full once
 *  it is `FULL_CONTACT_SINK` below. */
export function contactStrength(contact: ScrapeContact | null): number {
    if (!contact || !(contact.sink > 0) || !(contact.u > 0)) return 0;
    return Math.min(1, contact.sink / (FULL_CONTACT_SINK * contact.u));
}

const clampLean = (c: ScrapeContact): number => Math.max(-1, Math.min(1, c.lean));

/** The contact line's centre x (px), shifted toward the low wing by the lean. */
export const contactCentre = (c: ScrapeContact): number =>
    c.x + clampLean(c) * LEAN_SHIFT * c.halfWidth;

/** The contact line's half-length (px), narrowed by the lean. */
export const contactHalf = (c: ScrapeContact): number =>
    CONTACT_SPAN * c.halfWidth * (1 - LEAN_NARROW * Math.abs(clampLean(c)));

function spawn(fx: ScrapeFx, c: ScrapeContact, random: () => number): void {
    const i = fx.next;
    fx.next = (i + 1) % SCRAPE_SPARKS;
    const u = c.u;
    const side = random() < 0.5 * (1 - LEAN_SIDE_BIAS * clampLean(c)) ? -1 : 1;
    // Mostly from the hull's flanks, where it cuts the grid widest.
    const along = Math.sqrt(random()) * contactHalf(c);
    fx.px[i] = contactCentre(c) + side * along;
    fx.py[i] = c.y;
    // Back toward the camera (down the screen) and out to the side, with a little hop.
    fx.vx[i] = side * (0.35 + 1.1 * random()) * u;
    fx.vy[i] = (0.1 + 0.9 * random()) * u - 0.45 * random() * u;
    fx.age[i] = 0;
    fx.ttl[i] = 0.16 + 0.26 * random();
    fx.colour[i] = random() < 0.45 ? 2 : random() < 0.5 ? 0 : 1;
}

/**
 * Ages the scrape by `seconds` of game time: live sparks move, slow, fall and burn out, and the
 * contact, while the hull is sunk, throws new ones at `SPARK_RATE` scaled by its strength. No
 * time, no change. Mutates the pool in place; allocates nothing.
 */
export function advanceScrape(
    fx: ScrapeFx,
    seconds: number,
    contact: ScrapeContact | null,
    random: () => number = Math.random
): void {
    if (!(seconds > 0)) return;
    if (contact) fx.u = contact.u;
    const drag = Math.exp(-DRAG * seconds);
    for (let i = 0; i < SCRAPE_SPARKS; i++) {
        if (fx.age[i] >= fx.ttl[i]) continue;
        fx.vx[i] *= drag;
        fx.vy[i] = fx.vy[i] * drag + GRAVITY * fx.u * seconds;
        fx.px[i] += fx.vx[i] * seconds;
        fx.py[i] += fx.vy[i] * seconds;
        fx.age[i] += seconds;
    }
    const strength = contactStrength(contact);
    fx.glow += (strength - fx.glow) * (1 - Math.exp(-seconds / GLOW_SECONDS));
    if (!contact || strength <= 0) {
        fx.carry = 0;
        return;
    }
    fx.carry += SPARK_RATE * strength * seconds;
    // One advance never spawns more than the pool holds.
    let n = Math.min(SCRAPE_SPARKS, Math.floor(fx.carry));
    fx.carry -= Math.floor(fx.carry);
    while (n-- > 0) spawn(fx, contact, random);
}

/** Sparks still burning. */
export function liveSparks(fx: ScrapeFx): number {
    let n = 0;
    for (let i = 0; i < SCRAPE_SPARKS; i++) if (fx.age[i] < fx.ttl[i]) n++;
    return n;
}

const near: Projected = { x: 0, y: 0, scale: 0, width: 0 };
const far: Projected = { x: 0, y: 0, scale: 0, width: 0 };

/**
 * The streak burned into the grid behind the ship at lane offset `laneX`: hot at the hull,
 * fading toward the camera, as glow, halo and core. With the ship's `trail` it follows where the
 * ship was, so a slide bends it with the wake; without one it runs straight back. Drawn before
 * the ship, so the hull covers its head.
 */
export function drawScrapeStreak(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    fx: ScrapeFx,
    laneX: number,
    trail: ShipTrail | null,
    u: number
): void {
    if (fx.glow <= 0.01) return;
    const alpha = ctx.globalAlpha;
    const op = ctx.globalCompositeOperation;
    const cap = ctx.lineCap;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 3; pass++) {
        ctx.strokeStyle = pass === 2 ? '#ffe6fa' : pass === 1 ? COLOURS[0] : COLOURS[1];
        const gain = pass === 0 ? 0.22 : pass === 1 ? 0.5 : 0.9;
        const width = pass === 0 ? 0.07 : pass === 1 ? 0.028 : 0.009;
        for (let s = 0; s < STREAK_SEGMENTS; s++) {
            const k0 = s / STREAK_SEGMENTS;
            const k1 = (s + 1) / STREAK_SEGMENTS;
            const x0 = trail ? trailLaneX(trail, k0 * STREAK_AGE) : laneX;
            const x1 = trail ? trailLaneX(trail, k1 * STREAK_AGE) : laneX;
            projectInto(g, s === 0 ? laneX : x0, STREAK_Z * k0, far);
            projectInto(g, x1, STREAK_Z * k1, near);
            const fade = 1 - (k0 + k1) / 2;
            ctx.globalAlpha = alpha * fx.glow * gain * fade * fade;
            ctx.lineWidth = Math.max(1, width * u * (1 + k1));
            ctx.beginPath();
            ctx.moveTo(far.x, far.y);
            ctx.lineTo(near.x, near.y);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.lineCap = cap;
}

/**
 * The glowing contact line where the hull meets the track, as added light. Drawn before the ship,
 * so it lies on the track under the hull; `contact` is `null` once the hull has left the track,
 * and the line goes with it.
 */
export function drawScrapeContact(
    ctx: CanvasRenderingContext2D,
    fx: ScrapeFx,
    contact: ScrapeContact | null,
    u: number
): void {
    if (!contact || fx.glow <= 0.01) return;
    const alpha = ctx.globalAlpha;
    const op = ctx.globalCompositeOperation;
    const cap = ctx.lineCap;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const centre = contactCentre(contact);
    const half = contactHalf(contact);
    ctx.beginPath();
    ctx.moveTo(centre - half, contact.y);
    ctx.lineTo(centre + half, contact.y);
    for (let pass = 0; pass < 3; pass++) {
        ctx.strokeStyle = pass === 2 ? '#ffffff' : pass === 1 ? COLOURS[2] : COLOURS[0];
        const gain = pass === 0 ? 0.3 : pass === 1 ? 0.6 : 0.95;
        const width = pass === 0 ? 0.06 : pass === 1 ? 0.022 : 0.007;
        ctx.globalAlpha = alpha * fx.glow * gain;
        ctx.lineWidth = Math.max(1, width * u);
        ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.lineCap = cap;
}

/**
 * The sparks as short streaks along their motion, batched by colour and opacity step, all added
 * light. Drawn over the ship.
 */
export function drawScrapeSparks(ctx: CanvasRenderingContext2D, fx: ScrapeFx, u: number): void {
    const alpha = ctx.globalAlpha;
    const op = ctx.globalCompositeOperation;
    const cap = ctx.lineCap;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const sparkWidth = Math.max(1, 0.012 * u);
    ctx.lineWidth = sparkWidth;
    for (let c = 0; c < COLOURS.length; c++) {
        ctx.strokeStyle = COLOURS[c];
        for (let step = 1; step <= ALPHA_STEPS; step++) {
            const lo = (step - 1) / ALPHA_STEPS;
            const hi = step / ALPHA_STEPS;
            let any = false;
            ctx.beginPath();
            for (let i = 0; i < SCRAPE_SPARKS; i++) {
                if (fx.colour[i] !== c || fx.age[i] >= fx.ttl[i]) continue;
                const a = 1 - fx.age[i] / fx.ttl[i];
                if (a <= lo || a > hi) continue;
                const x = fx.px[i];
                const y = fx.py[i];
                ctx.moveTo(x, y);
                ctx.lineTo(x - fx.vx[i] * STREAK_SECONDS, y - fx.vy[i] * STREAK_SECONDS);
                any = true;
            }
            if (any) {
                ctx.globalAlpha = alpha * hi;
                ctx.stroke();
            }
        }
    }
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.lineCap = cap;
}
