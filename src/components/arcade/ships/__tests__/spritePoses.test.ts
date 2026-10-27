import { describe, expect, it } from 'vitest';
import { DUCK_SECONDS, JUMP_SECONDS } from '../../../../utils/arcade/constants';
import { jumpArc } from '../../../../utils/arcade/collision';
import {
    actionPitchDeg,
    BANK_ANGLES_DEG,
    CHASE_CAMERA,
    chasePose,
    advancePose,
    clampHeadingDeg,
    DUCK_EDGE,
    DUCK_PITCH_DEG,
    duckDip,
    easeToward,
    FRAME_GRID_POSES,
    frameBlend,
    FrameWeight,
    HEADING_ANGLES_DEG,
    LEVEL_BANK,
    LEVEL_HEADING,
    LEVEL_PITCH_ROW,
    MAX_HEADING_DEG,
    officialViewerCamera,
    PITCH_ANGLES_DEG,
    pickSweep,
    poseRotation,
    POSE_EASE_SECONDS,
    restingPose,
    settle,
    SETTLE_EPSILON,
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
    it('spans exactly the clamped heading range', () => {
        expect(Math.max(...HEADING_ANGLES_DEG)).toBe(MAX_HEADING_DEG);
        expect(Math.min(...HEADING_ANGLES_DEG)).toBe(-MAX_HEADING_DEG);
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

/** The blend's weighted mean along one axis, in that axis's angles. */
const blendedAngle = (
    blend: FrameWeight[],
    axis: 'heading' | 'bank' | 'pitch',
    values: readonly number[]
) => blend.reduce((sum, f) => sum + f.weight * values[f[axis]], 0);

describe('frameBlend', () => {
    const total = (blend: FrameWeight[]) => blend.reduce((sum, f) => sum + f.weight, 0);

    it('draws one frame at full weight when the pose sits on the grid', () => {
        expect(frameBlend(0, 0, 0)).toEqual([
            { heading: LEVEL_HEADING, bank: LEVEL_BANK, pitch: LEVEL_PITCH_ROW, weight: 1 },
        ]);
        const outer = frameBlend(MAX_HEADING_DEG, 1, PITCH_ANGLES_DEG[0]);
        expect(outer).toHaveLength(1);
        expect(HEADING_ANGLES_DEG[outer[0].heading]).toBe(MAX_HEADING_DEG);
        expect(BANK_ANGLES_DEG[outer[0].bank]).toBe(Math.max(...BANK_ANGLES_DEG));
        expect(PITCH_ANGLES_DEG[outer[0].pitch]).toBe(PITCH_ANGLES_DEG[0]);
    });
    it('splits evenly halfway between two headings', () => {
        const mid = (HEADING_ANGLES_DEG[LEVEL_HEADING] + HEADING_ANGLES_DEG[LEVEL_HEADING + 1]) / 2;
        const blend = frameBlend(mid, 0, 0);
        expect(blend.map((f) => [f.heading, f.weight])).toEqual([
            [LEVEL_HEADING, 0.5],
            [LEVEL_HEADING + 1, 0.5],
        ]);
    });
    it('reproduces any in-range pose as the weighted mean of its frames', () => {
        for (const heading of [-24, -16, -3.3, 7, 16, 21.9]) {
            for (const bank of [-1, -0.37, 0, 0.6]) {
                for (const pitch of [-8, -2.5, 0, 4, 10]) {
                    const blend = frameBlend(heading, bank, pitch);
                    expect(total(blend)).toBeCloseTo(1, 12);
                    expect(blend.length).toBeLessThanOrEqual(8);
                    for (const f of blend) expect(f.weight).toBeGreaterThan(0);
                    expect(blendedAngle(blend, 'heading', HEADING_ANGLES_DEG)).toBeCloseTo(
                        heading,
                        9
                    );
                    expect(blendedAngle(blend, 'bank', BANK_ANGLES_DEG)).toBeCloseTo(
                        bank * Math.max(...BANK_ANGLES_DEG),
                        9
                    );
                    expect(blendedAngle(blend, 'pitch', PITCH_ANGLES_DEG)).toBeCloseTo(pitch, 9);
                }
            }
        }
    });
    it('holds the outermost frame beyond the grid', () => {
        const [low, , high] = PITCH_ANGLES_DEG;
        expect(frameBlend(90, 4, 30)).toEqual(frameBlend(MAX_HEADING_DEG, 1, high));
        expect(frameBlend(-90, -4, -30)).toEqual(frameBlend(-MAX_HEADING_DEG, -1, low));
    });
});

describe('clampHeadingDeg', () => {
    it('leaves headings inside the limit alone and clamps the rest', () => {
        expect(clampHeadingDeg(16)).toBe(16);
        expect(clampHeadingDeg(-16)).toBe(-16);
        expect(clampHeadingDeg(46)).toBe(MAX_HEADING_DEG);
        expect(clampHeadingDeg(-46)).toBe(-MAX_HEADING_DEG);
    });
});

describe('easeToward', () => {
    it('closes 1 - 1/e of the gap per time constant', () => {
        expect(easeToward(0, 1, 0.1, 0.1)).toBeCloseTo(1 - Math.exp(-1), 12);
        expect(easeToward(5, 5, 0.3, 0.1)).toBe(5);
    });
    it('lands in the same place whatever the frame rate', () => {
        const run = (fps: number) => {
            let v = 0;
            for (let i = 0; i < Math.round(fps * 0.2); i++) v = easeToward(v, 10, 1 / fps, 0.08);
            return v;
        };
        expect(run(30)).toBeCloseTo(run(150), 9);
        expect(run(60)).toBeCloseTo(run(150), 9);
    });
    it('never overshoots, even on a long frame', () => {
        expect(easeToward(0, 1, 5, 0.05)).toBeLessThanOrEqual(1);
        expect(easeToward(0, 1, 5, 0.05)).toBeCloseTo(1, 9);
    });
    it('holds still for a zero frame and snaps for a zero time constant', () => {
        expect(easeToward(2, 7, 0, 0.1)).toBe(2);
        expect(easeToward(2, 7, 0.016, 0)).toBe(7);
    });
});

describe('settled poses', () => {
    it('treats an angle within a hair of a grid angle as on it', () => {
        expect(frameBlend(1e-12, -1e-9, 1e-10)).toEqual([
            { heading: LEVEL_HEADING, bank: LEVEL_BANK, pitch: LEVEL_PITCH_ROW, weight: 1 },
        ]);
        expect(frameBlend(MAX_HEADING_DEG / 2 - 1e-9, 0, 0)).toHaveLength(1);
    });
    it('a pose eased onto a resting target draws a single frame', () => {
        // Mid-slide toward the centre lane, whose computed heading is a rounding error off 0.
        let pose = { headingDeg: 9, bank: 0.6, pitchDeg: 4, duck: 0.3, skid: -0.4 };
        const target = { headingDeg: 3e-14, bank: 0, pitchDeg: 0, duck: 0, skid: 0 };
        for (let i = 0; i < 30; i++) pose = advancePose(pose, target, 1 / 60);
        expect(pose).toEqual(target);
        expect(frameBlend(pose.headingDeg, pose.bank, pose.pitchDeg)).toHaveLength(1);
    });
    it('snaps only within SETTLE_EPSILON', () => {
        expect(settle(1 - SETTLE_EPSILON / 2, 1)).toBe(1);
        expect(settle(1 - SETTLE_EPSILON * 2, 1)).toBe(1 - SETTLE_EPSILON * 2);
    });
});

describe('advancePose', () => {
    const target = { headingDeg: 20, bank: 1, pitchDeg: 10, duck: 1, skid: 1 };

    it('moves every axis toward its target by its own time constant', () => {
        const pose = advancePose(restingPose(), target, 0.03);
        expect(pose.headingDeg).toBeCloseTo(easeToward(0, 20, 0.03, POSE_EASE_SECONDS.heading), 12);
        expect(pose.bank).toBeCloseTo(easeToward(0, 1, 0.03, POSE_EASE_SECONDS.bank), 12);
        expect(pose.pitchDeg).toBeCloseTo(easeToward(0, 10, 0.03, POSE_EASE_SECONDS.pitch), 12);
        expect(pose.duck).toBeCloseTo(easeToward(0, 1, 0.03, POSE_EASE_SECONDS.duck), 12);
        expect(pose.skid).toBeCloseTo(easeToward(0, 1, 0.03, POSE_EASE_SECONDS.skid), 12);
    });
    it('glides in and out instead of snapping', () => {
        let pose = restingPose();
        pose = advancePose(pose, { ...restingPose(), pitchDeg: DUCK_PITCH_DEG, duck: 1 }, 1 / 60);
        expect(pose.duck).toBeGreaterThan(0);
        expect(pose.duck).toBeLessThan(0.5);
        expect(pose.pitchDeg).toBeLessThan(0);
        expect(pose.pitchDeg).toBeGreaterThan(DUCK_PITCH_DEG / 2);
    });
    it('settles within a quarter second, quick enough for a reflex game', () => {
        let pose = restingPose();
        for (let i = 0; i < 15; i++) pose = advancePose(pose, target, 1 / 60);
        expect(pose.headingDeg).toBeGreaterThan(0.95 * 20);
        expect(pose.bank).toBeGreaterThan(0.95);
        expect(pose.pitchDeg).toBeGreaterThan(0.95 * 10);
        expect(pose.duck).toBeGreaterThan(0.95);
        expect(pose.skid).toBeGreaterThan(0.95);
    });
    it('keeps every time constant between 30 and 150 ms', () => {
        for (const tau of Object.values(POSE_EASE_SECONDS)) {
            expect(tau).toBeGreaterThanOrEqual(0.03);
            expect(tau).toBeLessThanOrEqual(0.15);
        }
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
    it('dives a drop nose down at the landing pitch throughout', () => {
        expect(actionPitchDeg('drop', 0.08)).toBeCloseTo(jumpAt(1));
        expect(actionPitchDeg('drop', 0.01)).toBeCloseTo(jumpAt(1));
        expect(jumpAt(1)).toBeLessThan(0);
    });
    const duckAt = (t: number) => actionPitchDeg('duck', (1 - t) * DUCK_SECONDS);

    it('mirrors the jump in a duck: nose down diving, level at the bottom, up climbing back', () => {
        expect(duckAt(0)).toBeCloseTo(DUCK_PITCH_DEG);
        expect(duckAt(0.5)).toBeCloseTo(0);
        expect(duckAt(1)).toBeCloseTo(PITCH_ANGLES_DEG[PITCH_ANGLES_DEG.length - 1]);
        for (let t = 0; t < DUCK_EDGE; t += 0.02) expect(duckAt(t)).toBeLessThan(0);
        for (let t = DUCK_EDGE; t <= 1 - DUCK_EDGE; t += 0.02) expect(duckAt(t)).toBeCloseTo(0);
        for (let t = 1 - DUCK_EDGE + 0.01; t <= 1; t += 0.02) expect(duckAt(t)).toBeGreaterThan(0);
    });
    it('dives onto the nose-down row of the grid and climbs on the nose-up row', () => {
        expect(DUCK_PITCH_DEG).toBeLessThanOrEqual(-12);
        expect(frameBlend(0, 0, duckAt(0))).toEqual([
            { heading: LEVEL_HEADING, bank: LEVEL_BANK, pitch: 0, weight: 1 },
        ]);
        expect(
            blendedAngle(frameBlend(0, 0, duckAt(0.05)), 'pitch', PITCH_ANGLES_DEG)
        ).toBeLessThan(-10);
        expect(
            blendedAngle(frameBlend(0, 0, duckAt(0.95)), 'pitch', PITCH_ANGLES_DEG)
        ).toBeGreaterThan(7);
    });
    it('pitches with the dip: never nose up while it deepens, nor down while it rises', () => {
        const dt = DUCK_SECONDS / 400;
        for (let a = DUCK_SECONDS - dt; a > dt; a -= dt) {
            const deeper = duckDip(a - dt) - duckDip(a + dt);
            const pitch = actionPitchDeg('duck', a);
            if (deeper > 1e-6) expect(pitch).toBeLessThanOrEqual(0);
            else if (deeper < -1e-6) expect(pitch).toBeGreaterThanOrEqual(0);
            else expect(pitch).toBeCloseTo(0);
        }
    });
    it('raises the nose on take-off, levels at the top and dips on the way down', () => {
        expect(jumpAt(0)).toBeCloseTo(10);
        expect(jumpAt(0.5)).toBeCloseTo(0);
        expect(jumpAt(1)).toBeCloseTo(-8);
        expect(
            blendedAngle(frameBlend(0, 0, jumpAt(0.1)), 'pitch', PITCH_ANGLES_DEG)
        ).toBeGreaterThan(8);
        expect(blendedAngle(frameBlend(0, 0, jumpAt(0.5)), 'pitch', PITCH_ANGLES_DEG)).toBeCloseTo(
            0
        );
        expect(blendedAngle(frameBlend(0, 0, jumpAt(0.9)), 'pitch', PITCH_ANGLES_DEG)).toBeLessThan(
            -6
        );
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

describe('duckDip', () => {
    const at = (t: number) => duckDip((1 - t) * DUCK_SECONDS);

    it('is level at both ends and holds its full depth through the middle', () => {
        expect(at(0)).toBeCloseTo(0);
        expect(at(1)).toBeCloseTo(0);
        for (let t = DUCK_EDGE; t <= 1 - DUCK_EDGE; t += 0.02) expect(at(t)).toBeCloseTo(1);
        expect(DUCK_EDGE).toBeLessThanOrEqual(0.25);
    });
    it("eases in and out like the jump's arc, split at its peak", () => {
        for (let k = 0; k <= 1; k += 0.1) {
            const jump = jumpArc((1 - k / 2) * JUMP_SECONDS);
            expect(at(k * DUCK_EDGE)).toBeCloseTo(jump);
            expect(at(1 - k * DUCK_EDGE)).toBeCloseTo(jump);
        }
    });
    it('is level outside a duck', () => {
        expect(duckDip(0)).toBe(0);
        expect(duckDip(DUCK_SECONDS * 2)).toBe(0);
        expect(duckDip(-1)).toBe(0);
    });
});
