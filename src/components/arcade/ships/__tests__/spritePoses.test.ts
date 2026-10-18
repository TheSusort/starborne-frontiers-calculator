import { describe, expect, it } from 'vitest';
import { JUMP_SECONDS } from '../../../../utils/arcade/constants';
import {
    actionPitchDeg,
    BANK_ANGLES_DEG,
    CHASE_CAMERA,
    chasePose,
    FRAME_GRID_POSES,
    frameIndex,
    HEADING_ANGLES_DEG,
    LEVEL_BANK,
    LEVEL_HEADING,
    LEVEL_PITCH_ROW,
    officialViewerCamera,
    PITCH_ANGLES_DEG,
    pickSweep,
    poseRotation,
    slideBank,
    SpriteCamera,
    yawForScreenHeading,
} from '../spritePoses';

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
};

/** Screen angle of the nose (0 = straight up the screen, positive = toward screen right) of a
 *  ship yawed by `yawDeg`, found by perspective-projecting a point a short way along the nose. */
function projectedNoseHeading(camera: SpriteCamera, yawDeg: number): number {
    const eye = [...camera.position] as V3;
    const forward = norm(sub([0, 0, 0], eye));
    const right = norm(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const project = (p: V3) => {
        const v = sub(p, eye);
        const depth = dot(v, forward);
        return [dot(v, right) / depth, dot(v, up) / depth];
    };
    // The model's nose is +Z; yaw turns it toward the ship's right, -X.
    const r = poseRotation({ yawDeg, bankDeg: 0, pitchDeg: 0 });
    const nose: V3 = [Math.sin(r.y) * 1e-3, 0, Math.cos(r.y) * 1e-3];
    const [x0, y0] = project([0, 0, 0]);
    const [x1, y1] = project(nose);
    return deg(Math.atan2(x1 - x0, y1 - y0));
}

describe('frame grid', () => {
    it('has a level heading, bank and pitch and covers every combination', () => {
        expect(HEADING_ANGLES_DEG[LEVEL_HEADING]).toBe(0);
        expect(BANK_ANGLES_DEG[LEVEL_BANK]).toBe(0);
        expect(PITCH_ANGLES_DEG[LEVEL_PITCH_ROW]).toBe(0);
        expect(FRAME_GRID_POSES).toHaveLength(
            HEADING_ANGLES_DEG.length * BANK_ANGLES_DEG.length * PITCH_ANGLES_DEG.length
        );
    });
    it('covers the outer lanes on a wide screen', () => {
        expect(Math.max(...HEADING_ANGLES_DEG)).toBeGreaterThanOrEqual(45);
        expect(Math.min(...HEADING_ANGLES_DEG)).toBeLessThanOrEqual(-45);
    });
});

describe('yawForScreenHeading', () => {
    const behind: SpriteCamera = { fov: 30, position: [0, 1, -2.4] };

    it('turns the nose so it points along the requested screen heading', () => {
        for (const camera of [CHASE_CAMERA, behind]) {
            for (const heading of [-45, -30, -10, 0, 10, 30, 45]) {
                const yaw = yawForScreenHeading(heading, camera);
                expect(projectedNoseHeading(camera, yaw)).toBeCloseTo(heading, 4);
            }
        }
    });
    it('is zero straight ahead for a camera directly behind', () => {
        expect(yawForScreenHeading(0, behind)).toBeCloseTo(0, 9);
    });
    it('turns the nose toward the ship right for a heading toward screen right', () => {
        expect(yawForScreenHeading(30, behind)).toBeGreaterThan(0);
        expect(yawForScreenHeading(-30, behind)).toBeLessThan(0);
    });
    it('foreshortens by the camera elevation: tan(yaw) = tan(heading) * sin(elevation)', () => {
        const [, y, z] = behind.position;
        const elevation = Math.atan2(y, -z);
        const yaw = yawForScreenHeading(40, behind);
        expect(Math.tan(rad(yaw))).toBeCloseTo(Math.tan(rad(40)) * Math.sin(elevation), 9);
    });
    it('cancels the chase camera azimuth for the centre lane', () => {
        const [x, , z] = CHASE_CAMERA.position;
        const azimuthRight = deg(Math.atan2(-x, -z));
        expect(yawForScreenHeading(0, CHASE_CAMERA)).toBeCloseTo(-azimuthRight, 6);
    });
});

describe('chasePose', () => {
    it('keeps bank and pitch and yaws for the chase camera', () => {
        expect(chasePose(30, 25, -8)).toEqual({
            yawDeg: yawForScreenHeading(30, CHASE_CAMERA),
            bankDeg: 25,
            pitchDeg: -8,
        });
    });
});

describe('slideBank', () => {
    it('is level once the ship has settled in its lane', () => {
        expect(slideBank(1, 1)).toBe(0);
        expect(slideBank(-1, -1)).toBe(0);
    });
    it('banks toward the slide direction and fades as the ship arrives', () => {
        expect(slideBank(1, 0)).toBe(1);
        expect(slideBank(-1, 0)).toBe(-1);
        expect(slideBank(1, 0.8)).toBeCloseTo(0.4);
        expect(slideBank(0, 0.1)).toBeCloseTo(-0.2);
    });
    it('clamps to full bank', () => {
        expect(slideBank(1, -1)).toBe(1);
        expect(slideBank(-1, 1)).toBe(-1);
    });
});

describe('frameIndex', () => {
    it('picks the nearest heading column', () => {
        expect(frameIndex(0, 0, 0).heading).toBe(LEVEL_HEADING);
        expect(HEADING_ANGLES_DEG[frameIndex(44, 0, 0).heading]).toBe(45);
        expect(HEADING_ANGLES_DEG[frameIndex(-16, 0, 0).heading]).toBe(-22.5);
        expect(HEADING_ANGLES_DEG[frameIndex(10, 0, 0).heading]).toBe(0);
        expect(HEADING_ANGLES_DEG[frameIndex(90, 0, 0).heading]).toBe(45);
    });
    it('maps bank -1..1 onto the nearest bank', () => {
        expect(frameIndex(0, 0, 0).bank).toBe(LEVEL_BANK);
        expect(frameIndex(0, 0.3, 0).bank).toBe(LEVEL_BANK);
        expect(BANK_ANGLES_DEG[frameIndex(0, 0.7, 0).bank]).toBeGreaterThan(0);
        expect(BANK_ANGLES_DEG[frameIndex(0, -1, 0).bank]).toBeLessThan(0);
        expect(BANK_ANGLES_DEG[frameIndex(0, 4, 0).bank]).toBe(Math.max(...BANK_ANGLES_DEG));
    });
    it('picks the nearest pitch row', () => {
        expect(frameIndex(0, 0, 0).pitch).toBe(LEVEL_PITCH_ROW);
        expect(PITCH_ANGLES_DEG[frameIndex(0, 0, 9).pitch]).toBe(10);
        expect(PITCH_ANGLES_DEG[frameIndex(0, 0, -6).pitch]).toBe(-8);
        expect(PITCH_ANGLES_DEG[frameIndex(0, 0, 3).pitch]).toBe(0);
    });
});

describe('pickSweep', () => {
    const level = ['L'];
    const grid = (fill: (p: number, b: number) => string[] | null) =>
        PITCH_ANGLES_DEG.map((_, p) => BANK_ANGLES_DEG.map((_, b) => fill(p, b)));
    const banked = { heading: 0, bank: 0, pitch: 0 };

    it('uses the exact sweep when it has rendered', () => {
        const frames = grid((p, b) => [`${p}${b}`]);
        expect(pickSweep(frames, banked)).toEqual(['00']);
    });
    it('falls back to the level bank at the same pitch, then to the level sweep', () => {
        const pitchedOnly = grid((p, b) =>
            b === LEVEL_BANK ? (p === LEVEL_PITCH_ROW ? level : ['P']) : null
        );
        expect(pickSweep(pitchedOnly, banked)).toEqual(['P']);
        const levelOnly = grid((p, b) =>
            p === LEVEL_PITCH_ROW && b === LEVEL_BANK ? level : null
        );
        expect(pickSweep(levelOnly, banked)).toBe(level);
    });
    it('is null before the level sweep has rendered', () => {
        expect(
            pickSweep(
                grid(() => null),
                banked
            )
        ).toBeNull();
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
        expect(PITCH_ANGLES_DEG[frameIndex(0, 0, jumpAt(0.1)).pitch]).toBe(10);
        expect(PITCH_ANGLES_DEG[frameIndex(0, 0, jumpAt(0.5)).pitch]).toBe(0);
        expect(PITCH_ANGLES_DEG[frameIndex(0, 0, jumpAt(0.9)).pitch]).toBe(-8);
    });
    it('only falls while descending', () => {
        for (let t = 0; t <= 1; t += 0.05) {
            if (t < 0.5) expect(jumpAt(t)).toBeGreaterThanOrEqual(0);
            else expect(jumpAt(t)).toBeLessThanOrEqual(1e-9);
        }
    });
});

describe('poseRotation', () => {
    it('yaws, banks and pitches independently', () => {
        const r = poseRotation({ yawDeg: 20, bankDeg: 25, pitchDeg: 0 });
        // Negative rotation.y turns the nose (+Z) toward -X, the ship's right.
        expect(deg(r.y)).toBeCloseTo(-20);
        expect(deg(r.z)).toBeCloseTo(25);
        expect(deg(poseRotation({ yawDeg: 0, bankDeg: 25, pitchDeg: 0 }).y)).toBeCloseTo(0);
        expect(deg(poseRotation({ yawDeg: 20, bankDeg: 0, pitchDeg: 0 }).z)).toBeCloseTo(0);
    });
    it('raises the nose for positive pitch', () => {
        // Rotating +Z about X by x gives y = -sin(x); a raised nose needs y > 0.
        const up = poseRotation({ yawDeg: 0, bankDeg: 0, pitchDeg: 10 });
        expect(-Math.sin(up.x)).toBeGreaterThan(0);
        expect(poseRotation({ yawDeg: 0, bankDeg: 0, pitchDeg: 0 })).toEqual({
            x: -0,
            y: -0,
            z: 0,
        });
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
