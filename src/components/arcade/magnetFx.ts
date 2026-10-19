import { canCollect } from '../../utils/arcade/collision';
import { PICKUP_HEIGHT } from '../../utils/arcade/constants';
import type { Pickup, PlayerState } from '../../utils/arcade/types';
import { ARCADE_ACCENT_CSS } from './ships/arcadeAccent';

/**
 * The active magnet's look: the credits it will collect fly into the ship over their last
 * stretch of approach, each of the nearest joined to the ship by a tractor beam, and faint
 * magenta ripples pulse out around the ship. Purely visual: the engine still collects a credit
 * when it reaches z = 0 (`canCollect`). Beams and ripples are timed by game time, so they hold
 * still while the game does not step. Nothing here creates objects per frame and nothing uses
 * shadowBlur: the beam's gradient is built once in a unit space and mapped onto each beam by
 * transform.
 */

/** A pulled credit starts moving toward the ship this many world units before z = 0. */
export const MAGNET_PULL_Z = 12;
/** Beams drawn at once, to the nearest pulled credits. */
export const MAX_BEAMS = 4;
/** The ripples and beams flicker through the magnet's last seconds. */
export const MAGNET_EXPIRY_SECONDS = 1.5;
/** The flicker's rate as the expiry starts and as it ends; the top rate stays at or under the
 *  8 Hz strobing limit. */
export const FLICKER_MIN_HZ = 5;
export const FLICKER_MAX_HZ = 8;
/** A credit the magnet stops pulling eases back to its lane over this long (game seconds). */
export const RELEASE_SECONDS = 0.15;
/** How small a pulled credit is drawn as it reaches the ship, against its usual size. */
const LANDING_SCALE = 0.2;

/** Where a credit is drawn this frame: its lane offset, its centre's height above the track in
 *  lane widths at its row, its size against its usual one, and how brightly it flashes (0..1). */
export interface CreditPull {
    laneX: number;
    height: number;
    scale: number;
    glow: number;
}

/** Writes where `pickup` is drawn without a pull: on its lane at `PICKUP_HEIGHT`. */
export function restingPull(out: CreditPull, pickup: Pickup): void {
    out.laneX = pickup.lane - 1;
    out.height = PICKUP_HEIGHT;
    out.scale = 1;
    out.glow = 0;
}

/** How far a pickup is through the pull window, 0 at its far edge to 1 at z = 0, or -1 when the
 *  magnet does not pull it: it is not a credit the engine will collect, or it is outside the
 *  window (a credit still listed past z = 0 was not collected). */
function pullProgress(pickup: Pickup, player: PlayerState): number {
    if (pickup.kind !== 'credit' || player.magnetTime <= 0 || pickup.collected) return -1;
    if (pickup.z < 0 || pickup.z > MAGNET_PULL_Z || !canCollect(pickup, player)) return -1;
    return 1 - pickup.z / MAGNET_PULL_Z;
}

/**
 * Writes where `pickup` is drawn into `out` and returns whether the magnet is pulling it. A
 * pulled credit eases from its lane and height toward the drawn ship (`shipLaneX`, the ship's
 * centre `shipHeight` lane widths above the track) along `t²`, so it speeds up as it closes in,
 * and lands on the ship at z = 0, shrunk to `LANDING_SCALE` and at its brightest. Any other
 * pickup is drawn on its lane at `PICKUP_HEIGHT`.
 */
export function pullCredit(
    out: CreditPull,
    pickup: Pickup,
    player: PlayerState,
    shipLaneX: number,
    shipHeight: number
): boolean {
    const laneX = pickup.lane - 1;
    const t = pullProgress(pickup, player);
    if (t < 0) {
        restingPull(out, pickup);
        return false;
    }
    const e = t * t;
    out.laneX = t === 1 ? shipLaneX : laneX + (shipLaneX - laneX) * e;
    out.height = t === 1 ? shipHeight : PICKUP_HEIGHT + (shipHeight - PICKUP_HEIGHT) * e;
    out.scale = 1 - (1 - LANDING_SCALE) * e * t;
    out.glow = e * e;
    return true;
}

/** What the renderer remembers of a credit the magnet pulled, to ease it back to its lane if the
 *  pull ends before the credit is collected. `releasedAt` is -1 while it is being pulled. */
export interface PullRecord {
    id: number;
    laneX: number;
    height: number;
    scale: number;
    glow: number;
    /** Pull progress and beam strength when last pulled, for the beam's fade out. */
    t: number;
    visibility: number;
    beamed: boolean;
    releasedAt: number;
    /** The frame (`PullMemory.frame`) that last touched it. */
    seen: number;
    /** Written by `releasePull`: how much of the release is left, 1 down to 0. */
    fade: number;
}

/** The pulled credits of a view; records are reused, so a frame allocates none once it is warm. */
export interface PullMemory {
    records: PullRecord[];
    count: number;
    frame: number;
}

export const createPullMemory = (): PullMemory => ({ records: [], count: 0, frame: 0 });

const findRecord = (m: PullMemory, id: number): PullRecord | null => {
    for (let i = 0; i < m.count; i++) if (m.records[i].id === id) return m.records[i];
    return null;
};

/** Starts a frame's pass over the pickups: `rememberPull` or `releasePull` for each, then
 *  `endPulls`. */
export function beginPulls(m: PullMemory): void {
    m.frame++;
}

/** Records that `pickup` is drawn at `pull` this frame, `t` through its pull, in a beam or not,
 *  with the magnet at `visibility`. */
export function rememberPull(
    m: PullMemory,
    pickup: Pickup,
    pull: CreditPull,
    t: number,
    beamed: boolean,
    visibility: number
): void {
    let r = findRecord(m, pickup.id);
    if (!r) {
        if (m.count === m.records.length) {
            m.records.push({
                id: 0,
                laneX: 0,
                height: 0,
                scale: 1,
                glow: 0,
                t: 0,
                visibility: 0,
                beamed: false,
                releasedAt: -1,
                seen: 0,
                fade: 0,
            });
        }
        r = m.records[m.count++];
        r.id = pickup.id;
    }
    r.laneX = pull.laneX;
    r.height = pull.height;
    r.scale = pull.scale;
    r.glow = pull.glow;
    r.t = t;
    r.visibility = visibility;
    r.beamed = beamed;
    r.releasedAt = -1;
    r.seen = m.frame;
}

/**
 * For a pickup the magnet is not pulling this frame (`pull` holds where it rests): if it was
 * pulled, eases `pull` from where it was drawn back to its lane over `RELEASE_SECONDS` of game
 * `time`, and returns its record with `fade` set (1 as the release starts, 0 when it is over);
 * otherwise returns null and leaves `pull` alone.
 */
export function releasePull(
    m: PullMemory,
    pickup: Pickup,
    pull: CreditPull,
    time: number
): PullRecord | null {
    const r = findRecord(m, pickup.id);
    if (!r) return null;
    r.seen = m.frame;
    if (r.releasedAt < 0) r.releasedAt = time;
    const p = Math.min(1, Math.max(0, (time - r.releasedAt) / RELEASE_SECONDS));
    if (p >= 1) return null;
    const rest = 1 - (1 - p) * (1 - p);
    const k = 1 - rest;
    pull.laneX += (r.laneX - pull.laneX) * k;
    pull.height += (r.height - pull.height) * k;
    pull.scale += (r.scale - pull.scale) * k;
    pull.glow += (r.glow - pull.glow) * k;
    r.fade = 1 - p;
    return r;
}

/** Ends the pass: forgets every credit this frame did not touch. */
export function endPulls(m: PullMemory): void {
    for (let i = m.count - 1; i >= 0; i--) {
        if (m.records[i].seen === m.frame) continue;
        const last = --m.count;
        const gone = m.records[i];
        m.records[i] = m.records[last];
        m.records[last] = gone;
    }
}

/** Fills `scratch` with up to `max` of the credits the magnet is pulling, nearest first, and
 *  returns how many. Entries past the count are stale. */
export function nearestPulled(
    pickups: readonly Pickup[],
    player: PlayerState,
    max: number,
    scratch: Pickup[]
): number {
    let n = 0;
    for (const p of pickups) {
        if (pullProgress(p, player) < 0) continue;
        if (n === max && p.z >= scratch[n - 1].z) continue;
        let i = n < max ? n++ : n - 1;
        while (i > 0 && scratch[i - 1].z > p.z) {
            scratch[i] = scratch[i - 1];
            i--;
        }
        scratch[i] = p;
    }
    return n;
}

/**
 * How visible the magnet's ripples and beams are, 0..1: fully until its last
 * `MAGNET_EXPIRY_SECONDS`, then a flicker that quickens as it runs out (`time` in game seconds),
 * or under reduced motion a steady fade.
 */
export function magnetVisibility(magnetTime: number, time: number, reducedMotion: boolean): number {
    if (magnetTime >= MAGNET_EXPIRY_SECONDS) return 1;
    if (magnetTime <= 0) return 0;
    const left = magnetTime / MAGNET_EXPIRY_SECONDS;
    if (reducedMotion) return 0.25 + 0.75 * left;
    const rate = FLICKER_MIN_HZ + (FLICKER_MAX_HZ - FLICKER_MIN_HZ) * (1 - left);
    return Math.sin(2 * Math.PI * rate * time) > -0.3 ? 1 : 0.2;
}

const CORE = '150, 240, 255';
const PINK = '255, 79, 216';
const DASH_COLOUR = '#ffd9f6';

/** The beam's unit space: x runs 0 at the ship to `BEAM_UNITS` at the credit and y spans
 *  ±`BEAM_UNITS` across the credit end, so its shape is drawn in whole numbers. */
const BEAM_UNITS = 16;
/** The beam's half-width at the ship, in unit-space units. */
const BEAM_ROOT = 5;
/** The travelling dashes: their pattern along the beam, their width and speed in unit space. */
const BEAM_DASHES = [1.5, 4];
const DASH_WIDTH = 2;
const DASH_SPEED = 22;
/** The beam's opacity at full strength. */
const BEAM_ALPHA = 0.45;

let beamCtx: CanvasRenderingContext2D | null = null;
let beamFill: CanvasGradient | null = null;

/** The beam's cross-section in unit space, made once per context: clear edges, magenta, then a
 *  faint cyan core along its axis. */
function beamGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
    if (beamCtx === ctx && beamFill) return beamFill;
    const grad = ctx.createLinearGradient(0, -BEAM_UNITS, 0, BEAM_UNITS);
    grad.addColorStop(0, `rgba(${PINK}, 0)`);
    grad.addColorStop(0.3, `rgba(${PINK}, 0.35)`);
    grad.addColorStop(0.46, `rgba(${PINK}, 0.55)`);
    grad.addColorStop(0.5, `rgba(${CORE}, 0.7)`);
    grad.addColorStop(0.54, `rgba(${PINK}, 0.55)`);
    grad.addColorStop(0.7, `rgba(${PINK}, 0.35)`);
    grad.addColorStop(1, `rgba(${PINK}, 0)`);
    beamCtx = ctx;
    beamFill = grad;
    return grad;
}

/**
 * Draws a tractor beam from the ship at (`sx`, `sy`) to a credit at (`cx`, `cy`): a narrow cone
 * widening to `halfWidth` at the credit, added onto the scene. `t` is the credit's pull progress
 * (it fades in as the pull starts and out as the credit lands), `visibility` the magnet's
 * (`magnetVisibility`), `time` game seconds. Under reduced motion it has no travelling dashes.
 */
export function drawTractorBeam(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    cx: number,
    cy: number,
    halfWidth: number,
    t: number,
    visibility: number,
    time: number,
    reducedMotion: boolean
): void {
    const dx = cx - sx;
    const dy = cy - sy;
    const len = Math.hypot(dx, dy);
    const alpha = BEAM_ALPHA * visibility * Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.1);
    if (len < 1 || alpha <= 0) return;
    const across = halfWidth / BEAM_UNITS / len;
    ctx.save();
    ctx.transform(dx / BEAM_UNITS, dy / BEAM_UNITS, -dy * across, dx * across, sx, sy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = beamGradient(ctx);
    ctx.beginPath();
    ctx.moveTo(0, -BEAM_ROOT);
    ctx.lineTo(BEAM_UNITS, -BEAM_UNITS);
    ctx.lineTo(BEAM_UNITS, BEAM_UNITS);
    ctx.lineTo(0, BEAM_ROOT);
    ctx.closePath();
    ctx.fill();
    if (!reducedMotion) {
        ctx.strokeStyle = DASH_COLOUR;
        ctx.lineWidth = DASH_WIDTH;
        ctx.setLineDash(BEAM_DASHES);
        // A positive offset moves the pattern back toward the path's start, at the ship.
        ctx.lineDashOffset = (time * DASH_SPEED) % (BEAM_DASHES[0] + BEAM_DASHES[1]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(BEAM_UNITS, 0);
        ctx.stroke();
    }
    ctx.restore();
}

/** The ripples: how many, how long each takes to pulse out, how far it grows and its opacity. */
const RIPPLES = 3;
const RIPPLE_SECONDS = 1.4;
const RIPPLE_GROWTH = 0.5;
const RIPPLE_ALPHA = 0.3;
/** Each ripple is two arcs, on the ship's left and right, this many radians either side. */
const RIPPLE_SPAN = 0.85;

/**
 * Draws the magnet's field around the ship: faint magenta arcs either side of the ellipse
 * (`x`, `y`, `rx`, `ry`) that fits the drawn ship, pulsing outward and fading as they grow.
 * Under reduced motion the arcs hold still at fixed sizes.
 */
export function drawMagnetAura(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    visibility: number,
    time: number,
    reducedMotion: boolean
): void {
    if (visibility <= 0) return;
    const cos = Math.cos(RIPPLE_SPAN);
    const sin = Math.sin(RIPPLE_SPAN);
    ctx.save();
    ctx.strokeStyle = ARCADE_ACCENT_CSS;
    ctx.lineWidth = 1;
    for (let k = 0; k < RIPPLES; k++) {
        const phase = reducedMotion
            ? (k + 0.5) / RIPPLES
            : (time / RIPPLE_SECONDS + k / RIPPLES) % 1;
        const fade = reducedMotion ? 0.6 * (1 - phase) : Math.sin(Math.PI * phase);
        const grow = 1 + RIPPLE_GROWTH * phase;
        const ax = rx * grow;
        const ay = ry * grow;
        ctx.globalAlpha = RIPPLE_ALPHA * visibility * fade;
        ctx.beginPath();
        ctx.ellipse(x, y, ax, ay, 0, -RIPPLE_SPAN, RIPPLE_SPAN);
        ctx.moveTo(x - ax * cos, y + ay * sin);
        ctx.ellipse(x, y, ax, ay, 0, Math.PI - RIPPLE_SPAN, Math.PI + RIPPLE_SPAN);
        ctx.stroke();
    }
    ctx.restore();
}
