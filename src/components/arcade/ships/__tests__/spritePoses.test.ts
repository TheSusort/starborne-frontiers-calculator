import { describe, expect, it } from 'vitest';
import { JUMP_SECONDS } from '../../../../utils/arcade/constants';
import {
    actionPitchDeg,
    BANK_ANGLES_DEG,
    CHASE_CAMERA,
    FRAME_GRID_POSES,
    frameIndex,
    LEVEL_BANK_COLUMN,
    LEVEL_PITCH_ROW,
    MAX_YAW_DEG,
    officialViewerCamera,
    PITCH_ANGLES_DEG,
    poseRotation,
} from '../spritePoses';

const deg = (r: number) => (r * 180) / Math.PI;

describe('frame grid', () => {
    it('has a level row and column and covers every bank at every pitch', () => {
        expect(PITCH_ANGLES_DEG[LEVEL_PITCH_ROW]).toBe(0);
        expect(BANK_ANGLES_DEG[LEVEL_BANK_COLUMN]).toBe(0);
        expect(FRAME_GRID_POSES).toHaveLength(PITCH_ANGLES_DEG.length * BANK_ANGLES_DEG.length);
    });
});

describe('frameIndex', () => {
    it('maps bank -1..1 onto the left-to-right columns', () => {
        expect(frameIndex(-1, 0).column).toBe(0);
        expect(frameIndex(0, 0).column).toBe(LEVEL_BANK_COLUMN);
        expect(frameIndex(1, 0).column).toBe(BANK_ANGLES_DEG.length - 1);
        expect(frameIndex(0.5, 0).column).toBe(3);
        expect(frameIndex(4, 0).column).toBe(BANK_ANGLES_DEG.length - 1);
    });
    it('picks the nearest pitch row', () => {
        expect(frameIndex(0, 0).row).toBe(LEVEL_PITCH_ROW);
        expect(PITCH_ANGLES_DEG[frameIndex(0, 9).row]).toBe(10);
        expect(PITCH_ANGLES_DEG[frameIndex(0, -6).row]).toBe(-8);
        expect(PITCH_ANGLES_DEG[frameIndex(0, 3).row]).toBe(0);
    });
});

describe('actionPitchDeg', () => {
    const jumpAt = (t: number) => actionPitchDeg('jump', (1 - t) * JUMP_SECONDS);

    it('is level while running', () => {
        expect(actionPitchDeg('run', 0)).toBe(0);
    });
    it('dips the nose for a whole duck', () => {
        expect(actionPitchDeg('duck', 0.7)).toBe(-8);
        expect(actionPitchDeg('duck', 0.01)).toBe(-8);
    });
    it('raises the nose on take-off, levels at the top and dips on the way down', () => {
        expect(jumpAt(0)).toBeCloseTo(10);
        expect(jumpAt(0.5)).toBeCloseTo(0);
        expect(jumpAt(1)).toBeCloseTo(-8);
        expect(PITCH_ANGLES_DEG[frameIndex(0, jumpAt(0.1)).row]).toBe(10);
        expect(PITCH_ANGLES_DEG[frameIndex(0, jumpAt(0.5)).row]).toBe(0);
        expect(PITCH_ANGLES_DEG[frameIndex(0, jumpAt(0.9)).row]).toBe(-8);
    });
    it('only falls while descending', () => {
        for (let t = 0; t <= 1; t += 0.05) {
            if (t < 0.5) expect(jumpAt(t)).toBeGreaterThanOrEqual(0);
            else expect(jumpAt(t)).toBeLessThanOrEqual(1e-9);
        }
    });
});

describe('poseRotation', () => {
    it('yaws toward the banked side, a little at full bank', () => {
        const right = poseRotation({ bankDeg: 30, pitchDeg: 0 });
        // Negative yaw turns the nose (+Z) toward -X, the ship's right.
        expect(deg(right.y)).toBeCloseTo(-MAX_YAW_DEG);
        expect(deg(right.z)).toBeCloseTo(30);
        expect(deg(poseRotation({ bankDeg: -15, pitchDeg: 0 }).y)).toBeCloseTo(MAX_YAW_DEG / 2);
    });
    it('raises the nose for positive pitch', () => {
        // Rotating +Z about X by x gives y = -sin(x); a raised nose needs y > 0.
        const up = poseRotation({ bankDeg: 0, pitchDeg: 10 });
        expect(-Math.sin(up.x)).toBeGreaterThan(0);
        expect(poseRotation({ bankDeg: 0, pitchDeg: 0 })).toEqual({ x: -0, y: -0, z: 0 });
    });
});

describe('cameras', () => {
    const angles = ([x, y, z]: readonly [number, number, number]) => ({
        elevation: deg(Math.atan2(y, Math.hypot(x, z))),
        azimuth: deg(Math.atan2(x, z)),
    });

    it('chases from behind and above, a little to one side', () => {
        const { elevation, azimuth } = angles(CHASE_CAMERA.position);
        expect(CHASE_CAMERA.position[2]).toBeLessThan(0);
        expect(elevation).toBeGreaterThan(15);
        expect(elevation).toBeLessThan(30);
        expect(Math.abs(Math.abs(azimuth) - 180)).toBeGreaterThan(5);
        expect(Math.abs(Math.abs(azimuth) - 180)).toBeLessThan(20);
    });

    it('matches the official viewer: 38° fov at (2.2, 1.1, 2.6)', () => {
        expect(officialViewerCamera('left')).toEqual({ fov: 38, position: [2.2, 1.1, 2.6] });
        expect(officialViewerCamera('right')).toEqual({ fov: 38, position: [-2.2, 1.1, 2.6] });
        const { elevation, azimuth } = angles(officialViewerCamera('left').position);
        expect(elevation).toBeCloseTo(17.9, 1);
        expect(azimuth).toBeCloseTo(40.2, 1);
    });

    it('points the bow toward the requested side of the screen', () => {
        // Screen right for a camera at p looking at the origin with +Y up is (p.z, 0, -p.x),
        // so the bow (+Z) lands at screen x of sign -p.x.
        for (const facing of ['left', 'right'] as const) {
            const [x] = officialViewerCamera(facing).position;
            expect(Math.sign(-x)).toBe(facing === 'right' ? 1 : -1);
        }
    });
});
