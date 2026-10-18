import { JUMP_SECONDS } from '../../../utils/arcade/constants';
import type { PlayerAction } from '../../../utils/arcade/types';

/**
 * Pose and camera numbers for the rendered ship sprites. This module has no three.js
 * dependency, so the run's renderer can pick frames without loading the model chunk.
 *
 * Model frame (see `shipModelLoader`): nose toward +Z, up +Y, the ship's right wing toward -X,
 * centred on the origin.
 */

/** Roll angles of the frame columns, left bank to right bank; the middle column is level.
 *  A positive angle dips the ship's right wing. */
export const BANK_ANGLES_DEG = [-30, -15, 0, 15, 30] as const;
/** Pitch angles of the frame rows: nose down, level, nose up. */
export const PITCH_ANGLES_DEG = [-8, 0, 10] as const;
export const LEVEL_BANK_COLUMN = BANK_ANGLES_DEG.indexOf(0);
export const LEVEL_PITCH_ROW = PITCH_ANGLES_DEG.indexOf(0);
/** Yaw toward the banked side at full bank; it scales linearly with the roll. */
export const MAX_YAW_DEG = 8;
/** Nose pitch while ducking. */
export const DUCK_PITCH_DEG = -8;

export interface ShipPose {
    bankDeg: number;
    pitchDeg: number;
}

export interface EulerYXZ {
    x: number;
    y: number;
    z: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const maxBank = Math.max(...BANK_ANGLES_DEG.map(Math.abs));

/**
 * Model rotation for a pose, applied in three's `'YXZ'` order: yaw toward the banked side,
 * then pitch, then roll about the nose. Positive pitch raises the nose; positive bank dips the
 * right wing and turns the nose to the ship's right (-X).
 */
export function poseRotation({ bankDeg, pitchDeg }: ShipPose): EulerYXZ {
    return {
        y: -rad((bankDeg / maxBank) * MAX_YAW_DEG),
        x: -rad(pitchDeg),
        z: rad(bankDeg),
    };
}

/** Every pose of the run's frame grid, row-major by `PITCH_ANGLES_DEG` then `BANK_ANGLES_DEG`. */
export const FRAME_GRID_POSES: readonly ShipPose[] = PITCH_ANGLES_DEG.flatMap((pitchDeg) =>
    BANK_ANGLES_DEG.map((bankDeg) => ({ bankDeg, pitchDeg }))
);

/** The poses of one frame row. */
export const rowPoses = (row: number): ShipPose[] =>
    BANK_ANGLES_DEG.map((bankDeg) => ({ bankDeg, pitchDeg: PITCH_ANGLES_DEG[row] }));

const nearestIndex = (values: readonly number[], v: number) =>
    values.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(values[best] - v) ? i : best), 0);

/** Frame for a bank in -1..1 (full left to full right) and a nose pitch in degrees. */
export function frameIndex(bank: number, pitchDeg: number): { row: number; column: number } {
    const b = Math.max(-1, Math.min(1, bank));
    return {
        row: nearestIndex(PITCH_ANGLES_DEG, pitchDeg),
        column: Math.round(((b + 1) / 2) * (BANK_ANGLES_DEG.length - 1)),
    };
}

/**
 * Nose pitch for the player's action: a jump follows its arc's vertical speed (nose up while
 * rising, level at the top, down while falling), a duck dips the nose for its whole duration.
 */
export function actionPitchDeg(action: PlayerAction, actionTime: number): number {
    if (action === 'duck') return DUCK_PITCH_DEG;
    if (action !== 'jump') return 0;
    const t = 1 - actionTime / JUMP_SECONDS;
    const climb = Math.cos(Math.PI * t);
    const top = PITCH_ANGLES_DEG[PITCH_ANGLES_DEG.length - 1];
    return climb >= 0 ? climb * top : climb * -PITCH_ANGLES_DEG[0];
}

export interface SpriteCamera {
    fov: number;
    /** Camera position in the model frame; the camera looks at the origin. */
    position: readonly [number, number, number];
}

/** Behind, above and slightly to the ship's right: a chase view that still reads as flying
 *  away from the camera. */
export const CHASE_CAMERA: SpriteCamera = { fov: 30, position: [-0.55, 1.05, -2.4] };

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
