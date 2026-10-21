import { DUCK_SECONDS, JUMP_SECONDS } from '../../../utils/arcade/constants';
import { actionProgress } from '../../../utils/arcade/collision';
import type { PlayerAction } from '../../../utils/arcade/types';

/**
 * Pose and camera numbers for the rendered ship sprites. This module has no three.js
 * dependency, so the run's renderer can pick frames without loading the model chunk.
 *
 * Model frame (see `shipModelLoader`): nose toward +Z, up +Y, the ship's right wing toward -X,
 * centred on the origin.
 */

/** Largest screen heading the player ship turns to, in degrees. Narrow screens aim the outer
 *  lanes at the vanishing point within it; wider ones (up to about 46°) are held at it. */
export const MAX_HEADING_DEG = 25;
/** Screen headings of the frame grid's sweeps, in degrees: 0 points the nose straight up the
 *  screen, positive leans it toward screen right. They span ±`MAX_HEADING_DEG`. */
export const HEADING_ANGLES_DEG = [
    -MAX_HEADING_DEG,
    -MAX_HEADING_DEG / 2,
    0,
    MAX_HEADING_DEG / 2,
    MAX_HEADING_DEG,
] as const;
/** Roll angles, left bank to right bank; a positive angle dips the ship's right wing. */
export const BANK_ANGLES_DEG = [-25, 0, 25] as const;
/** Nose pitch as a duck dives: the ship tips its nose down toward the track. */
export const DUCK_PITCH_DEG = -14;
/** Nose pitch as a jump lands. */
export const JUMP_DIVE_DEG = -8;
/** Pitch angles: nose down (a duck's dive, so it draws unblended frames), level, nose up. */
export const PITCH_ANGLES_DEG = [DUCK_PITCH_DEG, 0, 10] as const;
export const LEVEL_HEADING = HEADING_ANGLES_DEG.indexOf(0);
export const LEVEL_BANK = BANK_ANGLES_DEG.indexOf(0);
export const LEVEL_PITCH_ROW = PITCH_ANGLES_DEG.indexOf(0);

export interface ShipPose {
    /** Turn of the nose about the vertical axis; positive turns it toward the ship's right. */
    yawDeg: number;
    bankDeg: number;
    pitchDeg: number;
}

export interface EulerYXZ {
    x: number;
    y: number;
    z: number;
}

export interface SpriteCamera {
    fov: number;
    /** Camera position in the model frame; the camera looks at the origin. */
    position: readonly [number, number, number];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * Model rotation for a pose, applied in three's `'YXZ'` order: yaw, then pitch, then roll about
 * the nose. Positive yaw turns the nose to the ship's right (-X), positive pitch raises it and
 * positive bank dips the right wing.
 */
export function poseRotation({ yawDeg, bankDeg, pitchDeg }: ShipPose): EulerYXZ {
    return { y: -rad(yawDeg), x: -rad(pitchDeg), z: rad(bankDeg) };
}

/**
 * The yaw that makes the nose, seen through `camera`, point along `headingDeg` on screen.
 *
 * The camera sits at P looking at the origin with +Y up, so its screen axes are
 * right R = normalise((P.z, 0, -P.x)) and up U = normalise(P) × R. A nose turned by yaw ψ toward
 * the ship's right is d = (-sin ψ, 0, cos ψ), and at the ship's centre it points along
 * (d·R, d·U) on screen. Setting d·R / d·U = tan(heading) = T and solving for ψ gives
 * tan ψ = (R.z - T·U.z) / (R.x - T·U.x). For a camera straight behind at elevation e this is
 * tan ψ = tan(heading) · sin(e); a camera off to one side adds the yaw that cancels its azimuth.
 */
export function yawForScreenHeading(headingDeg: number, camera: SpriteCamera): number {
    const [px, py, pz] = camera.position;
    const len = Math.hypot(px, py, pz);
    const b = [px / len, py / len, pz / len];
    const rLen = Math.hypot(b[2], b[0]);
    const r = [b[2] / rLen, 0, -b[0] / rLen];
    const u = [b[1] * r[2] - b[2] * r[1], b[2] * r[0] - b[0] * r[2], b[0] * r[1] - b[1] * r[0]];
    const t = Math.tan(rad(headingDeg));
    return deg(Math.atan((r[2] - t * u[2]) / (r[0] - t * u[0])));
}

/** Behind, above and slightly to the ship's right: a chase view that still reads as flying
 *  away from the camera. */
export const CHASE_CAMERA: SpriteCamera = { fov: 30, position: [-0.55, 1.05, -2.4] };

/** A run pose: the nose along `headingDeg` on screen under the chase camera, then banked and
 *  pitched. */
export function chasePose(headingDeg: number, bankDeg: number, pitchDeg: number): ShipPose {
    return { yawDeg: yawForScreenHeading(headingDeg, CHASE_CAMERA), bankDeg, pitchDeg };
}

/** One sweep of the run's frame grid, by index into `PITCH_ANGLES_DEG` and `BANK_ANGLES_DEG`. */
export interface SweepRef {
    pitch: number;
    bank: number;
}

/** One sweep of the frame grid: every heading at one pitch row and bank. */
export const sweepPoses = (pitch: number, bank: number): ShipPose[] =>
    HEADING_ANGLES_DEG.map((h) => chasePose(h, BANK_ANGLES_DEG[bank], PITCH_ANGLES_DEG[pitch]));

/** Every pose of the run's frame grid. */
export const FRAME_GRID_POSES: readonly ShipPose[] = PITCH_ANGLES_DEG.flatMap((_, pitch) =>
    BANK_ANGLES_DEG.flatMap((_, bank) => sweepPoses(pitch, bank))
);

/** The chase pose with the nose straight up the screen, wings level. */
export const LEVEL_CHASE_POSE: ShipPose = chasePose(0, 0, 0);

/** Rendered player frames: `[pitch row][bank]` holds one canvas per heading, or `null` while that
 *  sweep is still rendering. */
export type FrameSweeps<T> = (T[] | null)[][];

export interface FrameIndex {
    heading: number;
    bank: number;
    pitch: number;
}

/** One frame of a blend and its share of the drawn sprite. */
export interface FrameWeight extends FrameIndex {
    weight: number;
}

/** How close, in degrees, an angle must be to a grid angle to count as on it. */
const ON_GRID_DEG = 1e-6;

/** The one or two grid angles around `v` and their linear weights; beyond either end, the end
 *  angle alone, and within `ON_GRID_DEG` of a grid angle, that angle alone. */
function axisBlend(values: readonly number[], v: number): { i: number; w: number }[] {
    const last = values.length - 1;
    if (v <= values[0]) return [{ i: 0, w: 1 }];
    if (v >= values[last]) return [{ i: last, w: 1 }];
    const on = values.findIndex((x) => Math.abs(x - v) < ON_GRID_DEG);
    if (on >= 0) return [{ i: on, w: 1 }];
    const hi = values.findIndex((x) => x >= v);
    const w = (v - values[hi - 1]) / (values[hi] - values[hi - 1]);
    return [
        { i: hi - 1, w: 1 - w },
        { i: hi, w },
    ];
}

const maxBank = Math.max(...BANK_ANGLES_DEG);

/**
 * The frames to cross-fade for a screen heading in degrees, a bank in -1..1 (full left to full
 * right) and a nose pitch in degrees: linear weights on each axis, multiplied, so the weighted
 * mean of the frames' angles is the pose itself. A pose on the grid is one frame at weight 1.
 */
export function frameBlend(headingDeg: number, bank: number, pitchDeg: number): FrameWeight[] {
    const blend: FrameWeight[] = [];
    for (const p of axisBlend(PITCH_ANGLES_DEG, pitchDeg)) {
        for (const b of axisBlend(BANK_ANGLES_DEG, bank * maxBank)) {
            for (const h of axisBlend(HEADING_ANGLES_DEG, headingDeg)) {
                blend.push({ heading: h.i, bank: b.i, pitch: p.i, weight: p.w * b.w * h.w });
            }
        }
    }
    return blend;
}

export const clampHeadingDeg = (headingDeg: number): number =>
    Math.max(-MAX_HEADING_DEG, Math.min(MAX_HEADING_DEG, headingDeg));

/** The heading sweep to draw: the exact one if rendered, else the same pitch wings level, else
 *  the level sweep; `null` until the level sweep exists. */
export function pickSweep<T>(frames: FrameSweeps<T>, i: FrameIndex): T[] | null {
    return (
        frames[i.pitch]?.[i.bank] ??
        frames[i.pitch]?.[LEVEL_BANK] ??
        frames[LEVEL_PITCH_ROW]?.[LEVEL_BANK] ??
        null
    );
}

/**
 * Bank for a lane slide, -1..1 (positive banks right): proportional to the distance left to the
 * target lane, which under the run's exponential lane easing is proportional to the lateral
 * speed, so the ship rolls into the slide and returns to wings level as it settles.
 */
export function slideBank(targetLaneX: number, playerX: number): number {
    return Math.max(-1, Math.min(1, (targetLaneX - playerX) * 2));
}

/**
 * Moves `current` toward `target` by exponential approach with time constant `tauSeconds`: each
 * `tauSeconds` closes 1 - 1/e (63%) of the gap, and 2.3 time constants close 90%. The result
 * depends only on elapsed time, never on how it is split into frames, and never overshoots.
 */
export function easeToward(
    current: number,
    target: number,
    dtSeconds: number,
    tauSeconds: number
): number {
    if (tauSeconds <= 0) return target;
    return target + (current - target) * Math.exp(-dtSeconds / tauSeconds);
}

/**
 * Distance from its target at which an eased value snaps onto it: far below a visible step, and
 * it lets a settled pose land exactly on its target instead of approaching it forever.
 */
export const SETTLE_EPSILON = 1e-3;

export const settle = (value: number, target: number): number =>
    Math.abs(value - target) < SETTLE_EPSILON ? target : value;

/** The player ship's drawn pose: screen heading in degrees, bank -1..1, nose pitch in degrees,
 *  duck 0..1 (how deep into a duck's dip the ship is, see `duckDip`) and skid -1..1 (a duck's
 *  tail slide, positive toward screen right, see `skidTilt`). */
export interface PlayerPose {
    headingDeg: number;
    bank: number;
    pitchDeg: number;
    duck: number;
    skid: number;
}

export const restingPose = (): PlayerPose => ({
    headingDeg: 0,
    bank: 0,
    pitchDeg: 0,
    duck: 0,
    skid: 0,
});

/** Time constant of each pose axis's easing, in seconds (90% settled in 2.3×). The heading's
 *  target already turns continuously with the eased lane slide, so it only smooths frame steps;
 *  bank, pitch and duck have targets that jump when a slide, jump or duck starts or ends. */
export const POSE_EASE_SECONDS = {
    heading: 0.035,
    bank: 0.06,
    pitch: 0.05,
    duck: 0.045,
    skid: 0.05,
} as const;

/** The pose `dtSeconds` later, each axis eased toward `target` and snapped onto it once within
 *  `SETTLE_EPSILON`. */
export function advancePose(pose: PlayerPose, target: PlayerPose, dtSeconds: number): PlayerPose {
    const ease = (from: number, to: number, tau: number) =>
        settle(easeToward(from, to, dtSeconds, tau), to);
    return {
        headingDeg: ease(pose.headingDeg, target.headingDeg, POSE_EASE_SECONDS.heading),
        bank: ease(pose.bank, target.bank, POSE_EASE_SECONDS.bank),
        pitchDeg: ease(pose.pitchDeg, target.pitchDeg, POSE_EASE_SECONDS.pitch),
        duck: ease(pose.duck, target.duck, POSE_EASE_SECONDS.duck),
        skid: ease(pose.skid, target.skid, POSE_EASE_SECONDS.skid),
    };
}

/** The share of a duck spent diving, and again climbing back; it holds its depth between. */
export const DUCK_EDGE = 0.13;

/**
 * How deep a duck is, 0 level to 1 at its bottom: the jump's `sin(πt)` arc (see `jumpArc`) upside
 * down and split at its peak, the halves taking `DUCK_EDGE` of the duck each with the full depth
 * held between them. The plateau keeps the ship low for most of the duck, since a duck clears a
 * high block at any point of it.
 */
export function duckDip(actionTime: number): number {
    if (!(actionTime > 0)) return 0;
    const t = actionProgress(actionTime, DUCK_SECONDS);
    return Math.sin((Math.PI / 2) * Math.min(1, Math.min(t, 1 - t) / DUCK_EDGE));
}

/** An action's vertical speed scaled to -1..1, positive rising: a jump's `cos(πt)`, and a
 *  duck's, falling into its dip, 0 at the bottom and rising back out of it. */
function actionClimb(action: PlayerAction, actionTime: number): number {
    if (action === 'jump') return Math.cos(Math.PI * actionProgress(actionTime, JUMP_SECONDS));
    if (action !== 'duck') return 0;
    const t = actionProgress(actionTime, DUCK_SECONDS);
    if (t < DUCK_EDGE) return -Math.cos((Math.PI / 2) * (t / DUCK_EDGE));
    if (t > 1 - DUCK_EDGE) return Math.cos((Math.PI / 2) * ((1 - t) / DUCK_EDGE));
    return 0;
}

/**
 * Nose pitch for the player's action, following its vertical speed: nose up while rising, level
 * at the top or bottom, down while falling. A jump rises then falls, landing at
 * `JUMP_DIVE_DEG`; a duck mirrors it, diving at `DUCK_PITCH_DEG` and climbing back nose up.
 */
export function actionPitchDeg(action: PlayerAction, actionTime: number): number {
    const climb = actionClimb(action, actionTime);
    const top = PITCH_ANGLES_DEG[PITCH_ANGLES_DEG.length - 1];
    const down = action === 'duck' ? DUCK_PITCH_DEG : JUMP_DIVE_DEG;
    return climb >= 0 ? climb * top : -climb * down;
}

/**
 * The default camera of the official unit viewer (starborne.com/ship-viewer.html, embedded on
 * the unit pages): a 38° perspective camera at (2.2, 1.1, 2.6) looking at the model's centre,
 * which shows the bow pointing left. The viewer's own unit-card capture uses x = -2.2 to point
 * the bow right without mirroring the hull.
 */
export const OFFICIAL_VIEWER_FOV = 38;
const OFFICIAL_VIEWER_POSITION = [2.2, 1.1, 2.6] as const;

/** The official viewer camera with the bow pointing toward `facing` on screen. */
export function officialViewerCamera(facing: 'left' | 'right'): SpriteCamera {
    const [x, y, z] = OFFICIAL_VIEWER_POSITION;
    return { fov: OFFICIAL_VIEWER_FOV, position: [facing === 'left' ? x : -x, y, z] };
}
