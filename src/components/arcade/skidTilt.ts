import { actionProgress } from '../../utils/arcade/collision';
import { DUCK_SECONDS } from '../../utils/arcade/constants';

/**
 * A ducking ship skids along the track: its tail kicks out to one side as the hull hits the
 * track and swings back in behind the nose before the duck ends, a car's tail slide seen from
 * the chase camera (`duckSkid`). The skid turns the 3D sprite's nose against the tail where the
 * heading has room (`DRIFT_YAW_DEG`), twists the drawn ship about its nose (`SKID_TWIST`), and
 * leans the hull onto the tail's side (`skidRoll`), with a grind chatter while the belly scrapes.
 */

/** Nose swing at full skid, in screen-heading degrees; the heading still stops at
 *  `MAX_HEADING_DEG`, the widest the frame grid draws. */
export const DRIFT_YAW_DEG = 25;
/** Screen twist about the nose at full skid, in radians: the tail's swing, on every lane. */
export const SKID_TWIST = 0.3;
/** Extra roll at full bank on the bottom of a duck, on top of the pose's bank. */
export const DRIFT_ROLL = 0.2;
/** The share of `DRIFT_ROLL` a full skid leans the hull. */
const SKID_ROLL_SHARE = 0.5;
/** Peak roll of the grind chatter at full contact. */
export const CHATTER_ROLL = 0.06;
/** The chatter's two frequencies, in game hertz; incommensurate, so it never reads as a loop. */
const CHATTER_HZ = [13, 21.7] as const;
/** Shares of the duck: the tail is fully out by `KICK`, held until `HOLD`, and back in line by
 *  `SETTLE`. */
const KICK = 0.16;
const HOLD = 0.38;
const SETTLE = 0.92;

/**
 * The skid's swing over a duck's progress `t`, 0..1: out to 1 by `KICK`, held, then eased back
 * to 0 by `SETTLE` with no swing past it, as a driver catching the slide.
 */
export function driftSwing(t: number): number {
    if (!(t > 0) || t >= SETTLE) return 0;
    if (t < KICK) return Math.sin((Math.PI / 2) * (t / KICK));
    if (t < HOLD) return 1;
    const u = (t - HOLD) / (SETTLE - HOLD);
    return 0.5 + 0.5 * Math.cos(Math.PI * u);
}

/** Which way a duck's tail slides, +1 toward screen right: random per duck, fixed by when the
 *  duck started so it holds through it. */
export function driftSide(duckStartSeconds: number): 1 | -1 {
    const k = Math.sin(Math.round(duckStartSeconds * 60) * 12.9898) * 43758.5453;
    return k - Math.floor(k) < 0.5 ? 1 : -1;
}

/** The skid's target for a duck with `actionTime` left, -1..1 (positive: the tail out to screen
 *  right). */
export function duckSkid(actionTime: number, timeSeconds: number): number {
    const start = timeSeconds - (DUCK_SECONDS - actionTime);
    return driftSide(start) * driftSwing(actionProgress(actionTime, DUCK_SECONDS));
}

/**
 * The hull's extra screen roll in radians (positive rolls the right side down, like a positive
 * bank). The chatter runs on game time, so it holds still whenever the game does not step, and
 * is off under reduced motion.
 * @param duck how deep into a duck's dip the ship is, 0..1
 * @param bank the pose's bank, -1..1
 * @param skid the pose's skid, -1..1
 * @param contact how hard the hull scrapes, 0..1 (see `contactStrength`)
 */
export function skidRoll(
    duck: number,
    bank: number,
    skid: number,
    contact: number,
    timeSeconds: number,
    reducedMotion: boolean
): number {
    const drift = DRIFT_ROLL * duck * Math.max(-1, Math.min(1, bank + SKID_ROLL_SHARE * skid));
    if (reducedMotion || !(contact > 0)) return drift;
    const tau = 2 * Math.PI * timeSeconds;
    const wobble = 0.6 * Math.sin(tau * CHATTER_HZ[0]) + 0.4 * Math.sin(tau * CHATTER_HZ[1] + 1.3);
    return drift + CHATTER_ROLL * Math.min(1, contact) * wobble;
}

/** How far the skid has rolled the ship toward one side, -1..1, for where the hull bites. */
export const skidLean = (roll: number): number => Math.max(-1, Math.min(1, roll / DRIFT_ROLL));
