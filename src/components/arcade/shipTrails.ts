import type { SceneGeometry } from '../theme/synthwaveScene';
import { projectInto, type Projected } from './projection';
import { speedFraction } from './speedLines';

/**
 * Neon contrails streaming from the player ship toward the camera. The ship's recent lane
 * position, height and bank are kept in a fixed ring buffer, sampled by game time (so they hold
 * still whenever the game does not step); each sample is drawn further toward the camera the
 * older it is, so a lane slide leaves a trail that bends after the ship. The streaks come from
 * fixed points on the ship's footprint (wingtips and under the hull), not from a model's
 * engines, so they suit every ship. Nothing here allocates per frame.
 */

/** The trails are off until a design is chosen: no view creates a trail while this is false. */
export const SHIP_TRAILS_ENABLED = false;

/** Samples kept: comfortably more than `MAX_TRAIL_SECONDS` of samples. */
export const TRAIL_SAMPLES = 40;
/** Game time between samples. */
export const TRAIL_SAMPLE_SECONDS = 1 / 60;
/** How much game time the trail shows, at START_SPEED and at MAX_SPEED. */
export const MIN_TRAIL_SECONDS = 0.14;
export const MAX_TRAIL_SECONDS = 0.3;
/** World distance behind the ship that the oldest drawn sample reaches, at START_SPEED and at
 *  MAX_SPEED; past about 2 units it is below the bottom of the screen. A sample's distance grows
 *  with the square root of its age, so a slide bends the trail near the ship and it straightens
 *  toward the camera. */
const MIN_REACH = 1.4;
const MAX_REACH = 2.4;

export interface ShipTrail {
    laneX: Float64Array;
    lift: Float64Array;
    bank: Float64Array;
    /** Index the next sample is written to. */
    head: number;
    /** Samples written so far, up to `TRAIL_SAMPLES`. */
    count: number;
    /** Game time since the last sample. */
    sinceSample: number;
}

export function createShipTrail(): ShipTrail {
    return {
        laneX: new Float64Array(TRAIL_SAMPLES),
        lift: new Float64Array(TRAIL_SAMPLES),
        bank: new Float64Array(TRAIL_SAMPLES),
        head: 0,
        count: 0,
        sinceSample: 0,
    };
}

/**
 * Records the ship at lane offset `laneX`, `lift` lane widths above the track and banked `bank`
 * (-1..1) after `seconds` of game time. A sample is written each time `TRAIL_SAMPLE_SECONDS` has
 * gathered; a longer gap writes one sample, not several. No time, no sample.
 */
export function recordTrail(
    trail: ShipTrail,
    seconds: number,
    laneX: number,
    lift: number,
    bank: number
): void {
    if (!(seconds > 0)) return;
    trail.sinceSample += seconds;
    if (trail.count > 0 && trail.sinceSample < TRAIL_SAMPLE_SECONDS) return;
    trail.sinceSample = trail.count > 0 ? trail.sinceSample % TRAIL_SAMPLE_SECONDS : 0;
    const i = trail.head;
    trail.laneX[i] = laneX;
    trail.lift[i] = lift;
    trail.bank[i] = bank;
    trail.head = (i + 1) % TRAIL_SAMPLES;
    trail.count = Math.min(TRAIL_SAMPLES, trail.count + 1);
}

/** Buffer index of the `age`-th newest sample (0 = newest); `age` must be below `count`. */
export const sampleIndex = (trail: ShipTrail, age: number): number =>
    (trail.head - 1 - age + 2 * TRAIL_SAMPLES) % TRAIL_SAMPLES;

/** Game time since point `n` of a drawn streak: point 0 is the live ship, point `n` the
 *  (`n` - 1)-th newest sample. */
export const pointAge = (trail: ShipTrail, n: number): number =>
    n === 0 ? 0 : (n - 1) * TRAIL_SAMPLE_SECONDS + trail.sinceSample;

/** How long the trail is, in game seconds, at `speed`. */
export const trailSeconds = (speed: number): number =>
    MIN_TRAIL_SECONDS + (MAX_TRAIL_SECONDS - MIN_TRAIL_SECONDS) * speedFraction(speed);

interface Emitter {
    /** Lane offset from the ship's centre. */
    dx: number;
    /** Height below the ship's centre, in lane widths. */
    dy: number;
    glow: string;
    core: string;
    /** Width of the glow at the player row, in lane widths. */
    width: number;
}

/** Wingtip streaks in cyan, a pair under the hull in pink. */
const EMITTERS: readonly Emitter[] = [
    { dx: -0.24, dy: 0, glow: 'rgba(64, 240, 255, 0.3)', core: 'rgb(190, 252, 255)', width: 0.014 },
    { dx: 0.24, dy: 0, glow: 'rgba(64, 240, 255, 0.3)', core: 'rgb(190, 252, 255)', width: 0.014 },
    {
        dx: -0.07,
        dy: 0.05,
        glow: 'rgba(255, 79, 216, 0.22)',
        core: 'rgb(255, 150, 230)',
        width: 0.018,
    },
    {
        dx: 0.07,
        dy: 0.05,
        glow: 'rgba(255, 79, 216, 0.22)',
        core: 'rgb(255, 150, 230)',
        width: 0.018,
    },
];
/** A wingtip drops by this share of its offset at full bank, like the hull's roll. */
const BANK_DROP = 0.25;
/** Segments a streak is drawn in, each with its own width and opacity. */
const BUCKETS = 5;

const xs = new Float64Array(TRAIL_SAMPLES + 1);
const ys = new Float64Array(TRAIL_SAMPLES + 1);
const ws = new Float64Array(TRAIL_SAMPLES + 1);
const at: Projected = { x: 0, y: 0, scale: 0, width: 0 };

/**
 * Draws the streaks from the ship's current spot (`laneX`, `lift`, `bank`) back through the
 * recorded samples, fading toward the camera. `opacity` scales them (the intro fades them in).
 */
export function drawShipTrails(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    trail: ShipTrail,
    speed: number,
    laneX: number,
    lift: number,
    bank: number,
    opacity: number
): void {
    const seconds = trailSeconds(speed);
    const f = speedFraction(speed);
    const reach = MIN_REACH + (MAX_REACH - MIN_REACH) * f;
    const strength = opacity * (0.45 + 0.55 * f);
    if (strength <= 0 || trail.count === 0) return;
    // Samples within the trail's time, plus the live point.
    let points = 1;
    while (points <= trail.count && pointAge(trail, points) <= seconds) points++;
    if (points < 2) return;

    const alpha = ctx.globalAlpha;
    const cap = ctx.lineCap;
    ctx.lineCap = 'round';
    for (let k = 0; k < EMITTERS.length; k++) {
        const e = EMITTERS[k];
        for (let n = 0; n < points; n++) {
            const i = n === 0 ? -1 : sampleIndex(trail, n - 1);
            const sx = i < 0 ? laneX : trail.laneX[i];
            const sl = i < 0 ? lift : trail.lift[i];
            const sb = i < 0 ? bank : trail.bank[i];
            const z = -Math.sqrt(pointAge(trail, n) / seconds) * reach;
            projectInto(g, sx + e.dx, z, at);
            xs[n] = at.x;
            ys[n] = at.y - (sl - e.dy - e.dx * sb * BANK_DROP) * at.width;
            ws[n] = at.width;
        }
        const per = Math.ceil((points - 1) / BUCKETS);
        for (let b = 0; b * per < points - 1; b++) {
            const from = b * per;
            const to = Math.min(points - 1, from + per);
            const mid = (from + to) / 2 / (points - 1);
            const fade = strength * (1 - mid * mid);
            const width = ws[Math.round((from + to) / 2)] * e.width;
            ctx.beginPath();
            ctx.moveTo(xs[from], ys[from]);
            for (let n = from + 1; n <= to; n++) ctx.lineTo(xs[n], ys[n]);
            ctx.globalAlpha = alpha * fade;
            ctx.strokeStyle = e.glow;
            ctx.lineWidth = Math.max(2, width * 3);
            ctx.stroke();
            ctx.strokeStyle = e.core;
            ctx.lineWidth = Math.max(1, width * 0.7);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = alpha;
    ctx.lineCap = cap;
}
