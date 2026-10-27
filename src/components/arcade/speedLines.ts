import { MAX_SPEED, START_SPEED } from '../../utils/arcade/constants';
import type { SceneGeometry } from '../theme/synthwaveScene';
import { laneWidthAtPlayer, PLAYER_DEPTH } from './projection';

/** Lines drawn at START_SPEED and at MAX_SPEED, before the speed blur's extra lines. */
export const MIN_ACTIVE_LINES = 16;
export const MAX_ACTIVE_LINES = 40;
/** Lines the speed blur adds at full strength, and how much longer it makes every streak. */
export const BLUR_EXTRA_LINES = 16;
export const BLUR_STREAK_GAIN = 0.6;
/** Lines allocated once per run; `activeSpeedLines` and the speed blur decide how many draw. */
export const SPEED_LINE_POOL = MAX_ACTIVE_LINES + BLUR_EXTRA_LINES;
/** The share of START_SPEED..MAX_SPEED (`speedFraction`) at which the speed blur starts. */
export const BLUR_START = 0.6;
/** Streak length as a share of the head's distance from the vanishing point, at START_SPEED and
 *  at MAX_SPEED. */
export const MIN_STREAK = 0.12;
export const MAX_STREAK = 0.32;
/** A line's distance grows by `exp(RUSH_PER_UNIT × rate × travel)`, so it accelerates toward
 *  the camera the way a point on a perspective plane does. */
export const RUSH_PER_UNIT = 0.15;
/** Respawn distance, as a share of the vanishing point's distance to the farthest corner. */
const SPAWN_MIN = 0.06;
const SPAWN_MAX = 0.3;
/** Half-width of the kept-clear wedge, in lanes at the player row: the three lanes plus margin
 *  for the obstacles' and the ship's overhang. */
const WEDGE_LANES = 1.7;

export interface SpeedLine {
    /** Screen direction from the vanishing point (unit vector, y down). */
    dx: number;
    dy: number;
    /** Head distance from the vanishing point, 0..1 of the farthest corner's distance. */
    dist: number;
    /** Per-line speed multiplier, so the field never moves in lockstep. */
    rate: number;
    /** Index into the colour table. */
    hue: number;
}

export type SpeedLinePool = SpeedLine[];

type Random = () => number;

/** Glow (wide, faint) and core (thin, bright) stroke colours per hue. */
export interface SpeedLineColours {
    glow: readonly [string, string];
    core: readonly [string, string];
}

/** Neon pink and cyan. */
export const SUNSET_SPEED_LINES: SpeedLineColours = {
    glow: ['rgba(255, 79, 216, 0.16)', 'rgba(64, 240, 255, 0.14)'],
    core: ['rgba(255, 150, 230, 0.55)', 'rgba(150, 245, 255, 0.5)'],
};
const HUES = 2;

/** How far START_SPEED..MAX_SPEED the game is, clamped to 0..1. */
export function speedFraction(speed: number): number {
    return Math.max(0, Math.min(1, (speed - START_SPEED) / (MAX_SPEED - START_SPEED)));
}

export function activeSpeedLines(speed: number): number {
    const t = speedFraction(speed);
    return Math.round(MIN_ACTIVE_LINES + (MAX_ACTIVE_LINES - MIN_ACTIVE_LINES) * t);
}

export function streakLength(speed: number): number {
    return MIN_STREAK + (MAX_STREAK - MIN_STREAK) * speedFraction(speed);
}

/** The speed blur's strength: 0 up to `BLUR_START` of the speed range, rising linearly to 1 at
 *  MAX_SPEED. */
export function blurStrength(speed: number): number {
    return Math.max(0, (speedFraction(speed) - BLUR_START) / (1 - BLUR_START));
}

/**
 * Angle, from straight down the screen at the vanishing point, inside which no line spawns: the
 * wedge the lanes fan out in, so the streaks never cross the track the obstacles stand on.
 */
export function laneWedge(g: SceneGeometry): number {
    const rowY = g.gridHeight / PLAYER_DEPTH;
    return Math.atan2(WEDGE_LANES * laneWidthAtPlayer(g), rowY);
}

function respawn(line: SpeedLine, wedge: number, random: Random): void {
    // An angle from straight down outside the lane wedge, on either side.
    const a = wedge + random() * (Math.PI - wedge);
    const side = random() < 0.5 ? -1 : 1;
    line.dx = Math.sin(a) * side;
    line.dy = Math.cos(a);
    line.dist = SPAWN_MIN + random() * (SPAWN_MAX - SPAWN_MIN);
    line.rate = 0.75 + random() * 0.5;
    line.hue = Math.floor(random() * HUES);
}

/** Allocates the pool once, its lines spread over the whole distance range so the first frame
 *  is already full. */
export function createSpeedLines(wedge: number, random: Random = Math.random): SpeedLinePool {
    const pool: SpeedLinePool = [];
    for (let i = 0; i < SPEED_LINE_POOL; i++) {
        const line: SpeedLine = { dx: 0, dy: 1, dist: 0, rate: 1, hue: 0 };
        respawn(line, wedge, random);
        line.dist = SPAWN_MIN + random() * (1 - SPAWN_MIN);
        pool.push(line);
    }
    return pool;
}

/**
 * Moves every line outward by `travelUnits` of world travel and respawns the ones past the
 * farthest corner near the vanishing point, outside `wedge`. Lines move only with travel, so they
 * hold still whenever the game does not step. Mutates the pool in place; allocates nothing.
 */
export function advanceSpeedLines(
    pool: SpeedLinePool,
    travelUnits: number,
    wedge: number,
    random: Random = Math.random
): void {
    if (travelUnits <= 0) return;
    for (const line of pool) {
        line.dist *= Math.exp(RUSH_PER_UNIT * line.rate * travelUnits);
        if (line.dist > 1) respawn(line, wedge, random);
    }
}

/**
 * Draws the first `activeSpeedLines(speed)` lines, plus `BLUR_EXTRA_LINES` more and streaks up
 * to `BLUR_STREAK_GAIN` longer as the speed blur (`blurStrength`) rises, as streaks rushing out
 * of the vanishing point, fading in from it, with the double-stroke glow `drawGrid` uses (no
 * shadowBlur).
 */
export function drawSpeedLines(
    ctx: CanvasRenderingContext2D,
    g: SceneGeometry,
    pool: SpeedLinePool,
    speed: number,
    colours: SpeedLineColours = SUNSET_SPEED_LINES
): void {
    const blur = blurStrength(speed);
    const count = Math.min(
        pool.length,
        activeSpeedLines(speed) + Math.round(BLUR_EXTRA_LINES * blur)
    );
    const streak = Math.min(0.95, streakLength(speed) * (1 + BLUR_STREAK_GAIN * blur));
    const reach = Math.hypot(
        Math.max(g.vanishX, g.w - g.vanishX),
        Math.max(g.horizonY, g.h - g.horizonY)
    );
    const alpha = ctx.globalAlpha;
    const cap = ctx.lineCap;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
        const hues = pass === 0 ? colours.glow : colours.core;
        for (let i = 0; i < count; i++) {
            const line = pool[i];
            const head = line.dist * reach;
            const tail = head * (1 - streak);
            ctx.globalAlpha = alpha * Math.min(1, line.dist * 3);
            ctx.strokeStyle = hues[line.hue] ?? hues[0];
            ctx.lineWidth = pass === 0 ? 1 + 4 * line.dist : 0.6 + 1.4 * line.dist;
            ctx.beginPath();
            ctx.moveTo(g.vanishX + line.dx * tail, g.horizonY + line.dy * tail);
            ctx.lineTo(g.vanishX + line.dx * head, g.horizonY + line.dy * head);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = alpha;
    ctx.lineCap = cap;
}
