import type { SceneGeometry } from '../theme/synthwaveScene';
import { projectInto, type Projected } from './projection';
import { speedFraction } from './speedLines';

/**
 * The player ship's trails, in two layers:
 * - a light-cycle wake: two thin cyan lines on the track surface, starting a little behind the
 *   ship and running toward the camera, so a lane change leaves two smooth parallel curves;
 * - air-flow streaks: hair-thin dashes in a narrow cone just outside the drawn ship's silhouette,
 *   drifting toward the camera and locked to the ship (a slide only skews them a little).
 *
 * Where the ship was is a lag buffer rather than a history: point `k` follows the ship's lane
 * offset with a time constant that grows with its age (`lagTau`), so the head tracks the ship
 * closely and the tail swings over slowly, and a slide bends the whole trail at once. The buffer
 * and the streaks' drift advance by game time only, so the trails hold still whenever the game
 * does not step.
 *
 * Nothing here allocates per frame. A fractional number handed to a canvas call, or returned from
 * a call V8 does not inline, is boxed on the heap; so points and widths reach the canvas as whole
 * numbers of 1/`SUB` px under a 1/`SUB` scale, and helpers write their results to typed scratch
 * arrays rather than returning them.
 */

/** Points in the lag buffer, spread evenly over `LAG_MAX_AGE` seconds of age. */
export const LAG_POINTS = 61;
export const LAG_MAX_AGE = 0.6;
/** How slowly a trail point `age` seconds back follows the ship, in seconds. */
export const lagTau = (age: number): number => 0.015 + 0.6 * age;

const TAUS = Float64Array.from({ length: LAG_POINTS }, (_, k) =>
    lagTau((k / (LAG_POINTS - 1)) * LAG_MAX_AGE)
);

export interface ShipTrail {
    /** Lane offset of each lag point, youngest first. */
    lag: Float64Array;
    /** False until the first `advanceTrail`, which places every point on the ship. */
    primed: boolean;
    /** Game seconds the trail has advanced, which drifts the air-flow streaks. */
    clock: number;
}

export function createShipTrail(): ShipTrail {
    return { lag: new Float64Array(LAG_POINTS), primed: false, clock: 0 };
}

/** Moves every lag point toward the ship's lane offset `laneX` over `seconds` of game time. The
 *  first call places them all on the ship. No time, no movement. */
export function advanceTrail(trail: ShipTrail, seconds: number, laneX: number): void {
    if (!trail.primed) {
        trail.lag.fill(laneX);
        trail.primed = true;
    }
    if (!(seconds > 0)) return;
    trail.clock += seconds;
    for (let k = 0; k < LAG_POINTS; k++) {
        trail.lag[k] += (laneX - trail.lag[k]) * (1 - Math.exp(-seconds / TAUS[k]));
    }
}

/** Results of the per-point helpers, written here rather than returned (see the header). */
const scratch = new Float64Array(4);
const LANE = 0;
const ROW_CENTRE = 1;
const ROW_WIDTH = 2;
const ROW_Y = 3;

/** Writes the trail's lane offset `age` game seconds back to `scratch[LANE]`: interpolated
 *  between lag points and held at the oldest past `LAG_MAX_AGE`. */
function laneAt(trail: ShipTrail, age: number): void {
    const f = Math.min(LAG_POINTS - 1, (Math.max(0, age) / LAG_MAX_AGE) * (LAG_POINTS - 1));
    const i = Math.floor(f);
    const j = Math.min(LAG_POINTS - 1, i + 1);
    scratch[LANE] = trail.lag[i] + (trail.lag[j] - trail.lag[i]) * (f - i);
}

/** The trail's lane offset `age` game seconds back (see `laneAt`). */
export function trailLaneX(trail: ShipTrail, age: number): number {
    laneAt(trail, age);
    return scratch[LANE];
}

/** World depth (negative: toward the camera) of a trail point `age` seconds old over a trail of
 *  `span` seconds running from `z0` to `z1` behind the ship. Concave, so a slide bends the trail
 *  near the ship and it straightens toward the camera. */
const ageToZ = (age: number, span: number, z0: number, z1: number, curve: number): number =>
    -(z0 + (z1 - z0) * Math.pow(Math.min(1, age / span), curve));

/** The drawn ship's on-screen box (px): its centre, its visible half-width and the top and bottom
 *  of its visible pixels, and the track point under it. */
export interface ShipBox {
    x: number;
    y: number;
    halfWidth: number;
    top: number;
    bottom: number;
    /** Screen x and y of the track surface under the ship (`project` at the ship's lane, z = 0). */
    baseX: number;
    baseY: number;
}

const CYAN = 'rgb(64, 240, 255)';
const CYAN_CORE = 'rgb(188, 250, 255)';
const CYAN_STREAK = 'rgb(198, 251, 255)';
const ACCENT = 'rgb(255, 79, 216)';
const ACCENT_STREAK = 'rgb(255, 202, 244)';

const WAKE_POINTS = 48;
const WAKE_SPAN = 0.45;
/** Half the spacing of the two wake lines, in lane widths. */
const WAKE_GAP = 0.08;
const WAKE_ALPHA = 0.95;

const STREAK_POINTS = 20;
const STREAK_SPAN = 0.4;
/** A streak's length as a share of the span, at the mockup's speed (see `streakLength`). */
const STREAK_LENGTH = 0.55;
/** The cone opens this many lane widths outward over the span. */
const STREAK_SPREAD = 0.1;
/** The streaks' opacity against the wake. */
const STREAK_STRENGTH = 0.55;
/** The share of the wake's lag a streak follows: it stays locked to the ship and a slide only
 *  shears it a little, so it never crosses the hull. */
const STREAK_LAG = 0.25;

interface Streak {
    side: -1 | 1;
    /** Height on the silhouette where it leaves: 0 its bottom, 1 its top. */
    height: number;
    /** Outward margin from the silhouette, in lane widths. */
    margin: number;
    phase: number;
    passes: readonly Pass[];
}

/** In pairs, most prominent first: `streakPairs` turns on more of them as speed rises. */
const CYAN_PASSES = streakPasses(CYAN, CYAN_STREAK);
const ACCENT_PASSES = streakPasses(ACCENT, ACCENT_STREAK);
const STREAKS: readonly Streak[] = [
    { side: -1, height: 0.55, margin: 0.015, phase: 0.0, passes: CYAN_PASSES },
    { side: 1, height: 0.55, margin: 0.015, phase: 0.52, passes: CYAN_PASSES },
    { side: -1, height: 0.3, margin: 0.035, phase: 0.37, passes: ACCENT_PASSES },
    { side: 1, height: 0.3, margin: 0.035, phase: 0.09, passes: ACCENT_PASSES },
    { side: -1, height: 0.8, margin: 0.03, phase: 0.71, passes: CYAN_PASSES },
    { side: 1, height: 0.8, margin: 0.03, phase: 0.83, passes: CYAN_PASSES },
];

/** Streak pairs shown at `speed`: one at the start speed, all of them near the top speed. */
export const streakPairs = (speed: number): number => {
    const f = speedFraction(speed);
    return f < 0.3 ? 1 : f < 0.6 ? 2 : STREAKS.length / 2;
};

/** A streak's length as a share of the span at `speed`. */
export const streakLength = (speed: number): number =>
    STREAK_LENGTH * (0.6 + 0.45 * speedFraction(speed));

/** Segments merged into one stroke: a run shares its middle's width and opacity. */
const RUN = 3;

/** Samples of the streaks' track rows over their age span, interpolated between. */
const STREAK_ROWS = 64;

/**
 * Track rows at fixed depths: per row, the screen x of the track's centre line, one lane's width
 * (screen x is affine in the lane offset at a fixed depth: centre + laneX × width) and the
 * surface's screen y. They depend only on the screen size, so they are rebuilt only when it
 * changes, and a trail point costs no projection.
 */
interface Rows {
    centre: Float64Array;
    width: Float64Array;
    y: Float64Array;
}
const rows = (n: number): Rows => ({
    centre: new Float64Array(n),
    width: new Float64Array(n),
    y: new Float64Array(n),
});
const wakeRows = rows(WAKE_POINTS);
const streakRows = rows(STREAK_ROWS);
const rowsFor = { w: 0, h: 0 };
const at: Projected = { x: 0, y: 0, scale: 0, width: 0 };

function fillRows(g: SceneGeometry, out: Rows, n: number, zAt: (k: number) => number): void {
    for (let i = 0; i < n; i++) {
        projectInto(g, 0, zAt(i / (n - 1)), at);
        out.centre[i] = at.x;
        out.width[i] = at.width;
        out.y[i] = at.y;
    }
}

const wakeZ = (k: number) => ageToZ(k * WAKE_SPAN, WAKE_SPAN, 0.25, 2.3, 0.7);
const streakZ = (k: number) => ageToZ(k * STREAK_SPAN, STREAK_SPAN, 0.05, 2.2, 0.8);

function ensureRows(g: SceneGeometry): void {
    if (rowsFor.w === g.w && rowsFor.h === g.h) return;
    fillRows(g, wakeRows, WAKE_POINTS, wakeZ);
    fillRows(g, streakRows, STREAK_ROWS, streakZ);
    rowsFor.w = g.w;
    rowsFor.h = g.h;
}

/** The streak rows' values at `age`, interpolated, written to `scratch`. */
function streakRowAt(age: number): void {
    const f = Math.min(STREAK_ROWS - 1, (Math.max(0, age) / STREAK_SPAN) * (STREAK_ROWS - 1));
    const i = Math.floor(f);
    const j = Math.min(STREAK_ROWS - 1, i + 1);
    const t = f - i;
    const { centre, width, y } = streakRows;
    scratch[ROW_CENTRE] = centre[i] + (centre[j] - centre[i]) * t;
    scratch[ROW_WIDTH] = width[i] + (width[j] - width[i]) * t;
    scratch[ROW_Y] = y[i] + (y[j] - y[i]) * t;
}

const xs = new Float64Array(WAKE_POINTS);
const ys = new Float64Array(WAKE_POINTS);
const ws = new Float64Array(WAKE_POINTS);

/** Canvas units per px while the trails draw (see the header). */
export const SUB = 16;
const toSub = (v: number): number => Math.round(v * SUB) | 0;

/** One stroke of a neon line: its colour, opacity gain and width, `max(min, w × scale)` px for
 *  `w` the line's lane width. */
interface Pass {
    colour: string;
    gain: number;
    min: number;
    scale: number;
}

/**
 * Strokes the polyline in `xs`/`ys` (`n` points, px) in runs of `RUN` segments, each with the
 * opacity `opacity × gain × fade(k)` and width of its middle (`k` 0..1 along the line). The fade
 * is the wake's (in quickly, out slowly) when `wake`, else the streaks' (a sine). Each run's path
 * is built once and stroked once per pass; under additive compositing the order of the strokes
 * does not change the result. Draws in 1/`SUB` px units.
 */
function strokeRuns(
    ctx: CanvasRenderingContext2D,
    n: number,
    opacity: number,
    wake: boolean,
    passes: readonly Pass[]
): void {
    for (let from = 0; from < n - 1; from += RUN) {
        const to = Math.min(n - 1, from + RUN);
        const k = (from + to) / 2 / (n - 1);
        const fade = wake ? Math.min(1, k / 0.12) * Math.pow(1 - k, 1.2) : Math.sin(Math.PI * k);
        const a = opacity * fade;
        if (a <= 0.003) continue;
        const w = (ws[from] + ws[to]) / 2;
        ctx.beginPath();
        ctx.moveTo(toSub(xs[from]), toSub(ys[from]));
        for (let i = from + 1; i <= to; i++) ctx.lineTo(toSub(xs[i]), toSub(ys[i]));
        for (let p = 0; p < passes.length; p++) {
            const pass = passes[p];
            const passAlpha = a * pass.gain;
            if (passAlpha <= 0.003) continue;
            ctx.strokeStyle = pass.colour;
            ctx.globalAlpha = passAlpha;
            ctx.lineWidth = toSub(Math.max(pass.min, w * pass.scale));
            ctx.stroke();
        }
    }
}

/** The wake's hot core is `max(0.8, w × 0.0045)` px; its halo and glow are multiples of it. */
const wakePass = (colour: string, gain: number, times: number): Pass => ({
    colour,
    gain,
    min: 0.8 * times,
    scale: 0.0045 * times,
});
/** A wide faint glow, a mid halo and a hair-thin hot core. */
const WAKE_PASSES: readonly Pass[] = [
    wakePass(CYAN, 0.12, 7),
    wakePass(CYAN, 0.35, 2.6),
    wakePass(CYAN_CORE, 1, 1),
];
/** A faint glow and a hair-thin core. */
function streakPasses(glow: string, core: string): readonly Pass[] {
    return [
        { colour: glow, gain: 0.18, min: 1.6, scale: 0.008 },
        { colour: core, gain: 1, min: 0.6, scale: 0.0022 },
    ];
}

/** The light-cycle wake: two neon lines (glow, halo, hot core) on the track. */
function drawWake(ctx: CanvasRenderingContext2D, trail: ShipTrail, opacity: number): void {
    for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < WAKE_POINTS; i++) {
            const age = (i / (WAKE_POINTS - 1)) * WAKE_SPAN;
            const width = wakeRows.width[i];
            laneAt(trail, age);
            xs[i] = wakeRows.centre[i] + (scratch[LANE] + side * WAKE_GAP) * width;
            ys[i] = wakeRows.y[i];
            ws[i] = width;
        }
        strokeRuns(ctx, WAKE_POINTS, opacity * WAKE_ALPHA, true, WAKE_PASSES);
    }
}

/** The air-flow streaks in a cone just outside the ship's silhouette `box`. */
function drawAirflow(
    ctx: CanvasRenderingContext2D,
    trail: ShipTrail,
    speed: number,
    laneX: number,
    box: ShipBox,
    u: number,
    opacity: number
): void {
    const count = 2 * streakPairs(speed);
    const length = streakLength(speed);
    for (let s = 0; s < count; s++) {
        const { side, height, margin, phase, passes } = STREAKS[s];
        const edge = box.x + side * box.halfWidth;
        const dx0 = (edge - box.baseX) / u + side * margin;
        const leaveY = box.y + box.bottom + (box.top - box.bottom) * height;
        // Height of the leaving point above the track, and above the ship's centre.
        const h0 = (box.baseY - leaveY) / u;
        const dh0 = (box.y - leaveY) / u;
        const head = (trail.clock * 1.6 + phase) % 1;
        const a0 = head * (1 - length) * STREAK_SPAN;
        for (let i = 0; i < STREAK_POINTS; i++) {
            const k = i / (STREAK_POINTS - 1);
            const age = a0 + k * length * STREAK_SPAN;
            laneAt(trail, age);
            const x = laneX + (scratch[LANE] - laneX) * STREAK_LAG;
            const open = Math.pow(age / STREAK_SPAN, 0.8);
            streakRowAt(age);
            const width = scratch[ROW_WIDTH];
            xs[i] = scratch[ROW_CENTRE] + (x + dx0 + side * STREAK_SPREAD * open) * width;
            ys[i] = scratch[ROW_Y] - (h0 - 0.4 * open * dh0) * width;
            ws[i] = width;
        }
        const strength = opacity * STREAK_STRENGTH * 0.85 * Math.sqrt(Math.sin(Math.PI * head));
        strokeRuns(ctx, STREAK_POINTS, strength, false, passes);
    }
}

/**
 * Draws the wake and the air-flow streaks for the ship at lane offset `laneX`, drawn in `box`,
 * with `u` the lane width at the player row. `opacity` scales both (the intro fades them in).
 * Drawn before the ship, so the hull covers them.
 */
export function drawShipTrails(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    trail: ShipTrail,
    speed: number,
    laneX: number,
    box: ShipBox,
    u: number,
    opacity: number
): void {
    if (opacity <= 0 || !trail.primed) return;
    const alpha = ctx.globalAlpha;
    const cap = ctx.lineCap;
    const op = ctx.globalCompositeOperation;
    ensureRows(g);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.scale(1 / SUB, 1 / SUB);
    drawWake(ctx, trail, opacity);
    drawAirflow(ctx, trail, speed, laneX, box, u, opacity);
    ctx.scale(SUB, SUB);
    ctx.globalAlpha = alpha;
    ctx.lineCap = cap;
    ctx.globalCompositeOperation = op;
}
